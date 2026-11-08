import { Invoke } from './interpreter.js?v=99056e83c7d5';
import { PACKAGE_VALUE_PARENTS } from './package-value-fields.js?v=99056e83c7d5';
import { createComposeCanvasHost } from './compose-canvas-host.js?v=99056e83c7d5';
import { createViewTransformHost } from './view-transform-host.js?v=99056e83c7d5';
import { createViewPropertyAnimatorHost } from './view-property-animator-host.js?v=99056e83c7d5';
import { createViewOutlineHost } from './view-outline-host.js?v=99056e83c7d5';
import { createShaderHost } from './shader-host.js?v=99056e83c7d5';
import { createSystemBarsHost } from './system-bars-host.js?v=99056e83c7d5';
import { createDeviceStateHost } from './device-state-host.js?v=99056e83c7d5';
import { createJobSchedulerHost } from './job-scheduler-host.js?v=99056e83c7d5';
import { createPendingIntentHost } from './pending-intent-host.js?v=99056e83c7d5';
import { ActivityStarter, activityInfoOf, FLAG as LAUNCH_FLAG } from './activity-starter.js?v=99056e83c7d5';
import { createBinderHost } from './binder-host.js?v=99056e83c7d5';
import { createInputManagerHost } from './input-native.js?v=99056e83c7d5';
import { createBackDispatcherHost } from './back-dispatcher-host.js?v=99056e83c7d5';
import { createRenderThreadAnimators } from './rt-animators.js?v=99056e83c7d5';
import { renderNodeByHandle } from './rendernode-native.js?v=99056e83c7d5';
import { resolveDevice } from './device-profile.js?v=99056e83c7d5';
import { configurationFor } from './device-configuration.js?v=99056e83c7d5';
import { createViewCoordinateHost } from './view-coordinate-host.js?v=99056e83c7d5';
import { createEditableTextHost } from './editable-text-host.js?v=99056e83c7d5';
import { createComponentCallbacksHost } from './component-callbacks-host.js?v=99056e83c7d5';
import { createViewStateHost } from './view-state-host.js?v=99056e83c7d5';
import { createLocaleServiceHost } from './locale-service-host.js?v=99056e83c7d5';
import { APKError } from './apk-runtime.js?v=99056e83c7d5';
import { AndroidXmlHost, XML_METHODS } from './android-xml-host.js?v=99056e83c7d5';
import { createViewTreeHost } from './view-tree-host.js?v=99056e83c7d5';
import { createDialogWindowHost } from './dialog-window-host.js?v=99056e83c7d5';
import { createStrictModeHost } from './strictmode-host.js?v=99056e83c7d5';
import { createProgressBarApiHost } from './progress-bar-api-host.js?v=99056e83c7d5';
import { createViewGroupApiHost } from './viewgroup-api-host.js?v=99056e83c7d5';
import { createViewInternalsHost } from './view-internals-host.js?v=99056e83c7d5';
import { createViewWindowHost } from './view-window-host.js?v=99056e83c7d5';
import { createVectorCanvasHost } from './vector-native.js?v=99056e83c7d5';
import { createPaintHost } from './paint-host.js?v=99056e83c7d5';
import { createContentResolverHost } from './content-resolver-host.js?v=99056e83c7d5';
import { createDrawableViewHost } from './drawable-view-host.js?v=99056e83c7d5';
import { createDeviceServicesHost } from './device-services-host.js?v=99056e83c7d5';
import { createSystemServicesHost } from './system-services-host.js?v=99056e83c7d5';
import { createJavaIoHost } from './java-io-host.js?v=99056e83c7d5';
import { createClassLoaderHost } from './class-loader-host.js?v=99056e83c7d5';
import { createAppServicesHost } from './app-services-host.js?v=99056e83c7d5';
import { createConcurrencyHost } from './concurrency-host.js?v=99056e83c7d5';
import { createLooperHost } from './looper-host.js?v=99056e83c7d5';
import { createDateTimeHost } from './datetime-host.js?v=99056e83c7d5';
const LOCALE_CONSTANTS = { US: 'en-US', UK: 'en-GB', ENGLISH: 'en', ROOT: 'und', CANADA: 'en-CA', CANADA_FRENCH: 'fr-CA', FRANCE: 'fr-FR', FRENCH: 'fr', GERMAN: 'de', GERMANY: 'de-DE', ITALIAN: 'it', ITALY: 'it-IT', JAPAN: 'ja-JP', JAPANESE: 'ja', KOREA: 'ko-KR', KOREAN: 'ko', CHINA: 'zh-CN', CHINESE: 'zh', PRC: 'zh-CN', SIMPLIFIED_CHINESE: 'zh-CN', TAIWAN: 'zh-TW', TRADITIONAL_CHINESE: 'zh-TW' };
import { createNumberFormatHost } from './number-format-host.js?v=99056e83c7d5';
import { createCookieHost } from './cookie-host.js?v=99056e83c7d5';
import { createViewApiHost } from './view-api-host.js?v=99056e83c7d5';
import { createTextViewApiHost } from './textview-api-host.js?v=99056e83c7d5';
import { createIntentApiHost } from './intent-api-host.js?v=99056e83c7d5';
import { createImageDecoderHost } from './image-decoder-host.js?v=99056e83c7d5';
import { createPlatformDataClassesHost } from './platform-data-classes-host.js?v=99056e83c7d5';
import { createToastHost } from './toast-host.js?v=99056e83c7d5';
import { createIcuTextHost } from './icu-text-host.js?v=99056e83c7d5';
import { createMiscPlatformHost } from './misc-platform-host.js?v=99056e83c7d5';
import { createRemoteViewsHost } from './remote-views-host.js?v=99056e83c7d5';
import { createPackageManagerApiHost } from './package-manager-api-host.js?v=99056e83c7d5';
import { createPackageValueObjectsHost } from './package-value-objects.js?v=99056e83c7d5';
import { createNetworkInfoHost } from './network-info-host.js?v=99056e83c7d5';
import { createApkChecksumsHost } from './apk-checksums-host.js?v=99056e83c7d5';
import { createContentResolverApiHost } from './content-resolver-api-host.js?v=99056e83c7d5';
import { createActivityApiHost, forcedOrientationOf } from './activity-api-host.js?v=99056e83c7d5';
import { createImageViewApiHost } from './image-view-api-host.js?v=99056e83c7d5';
import { createUriApiHost } from './uri-api-host.js?v=99056e83c7d5';
import { createFormatterHost } from './formatter-host.js?v=99056e83c7d5';
import { createJcaHost } from './jca-host.js?v=99056e83c7d5';
import { createIcuBidiHost } from './icu-bidi-host.js?v=99056e83c7d5';
import { createSecurityHost } from './security-host.js?v=99056e83c7d5';
import { createReflectionHost } from './reflection-host.js?v=99056e83c7d5';
import { createSerializationHost } from './serialization-host.js?v=99056e83c7d5';
import { createBitmapCodecHost } from './bitmap-codec-host.js?v=99056e83c7d5';
import { createBitmapDrawableHost } from './bitmap-drawable-host.js?v=99056e83c7d5';
import { createImageViewHost } from './image-view-host.js?v=99056e83c7d5';
import { createWebViewHost } from './webview-host.js?v=99056e83c7d5';
import { createContentExtrasHost } from './content-extras-host.js?v=99056e83c7d5';
import { createPreferenceManagerHost } from './preference-manager-host.js?v=99056e83c7d5';
import { createProcessHost } from './process-host.js?v=99056e83c7d5';
import { createStatsHost } from './stats-host.js?v=99056e83c7d5';
import { createTelephonyHost } from './telephony-host.js?v=99056e83c7d5';
import { createSurfaceTextureHost } from './surface-texture-host.js?v=99056e83c7d5';
import { createBuildHost } from './build-host.js?v=99056e83c7d5';
import { createSensorHost } from './sensor-host.js?v=99056e83c7d5';
import { createGeocoderHost } from './geocoder-host.js?v=99056e83c7d5';
import { createCoreLangHost } from './core-lang-host.js?v=99056e83c7d5';
import { createResourcesExtrasHost } from './resources-extras-host.js?v=99056e83c7d5';
import { createSimpleTimeZoneHost } from './simple-timezone-host.js?v=99056e83c7d5';
import { createActivityManagerExtrasHost } from './activity-manager-extras-host.js?v=99056e83c7d5';
import { createManagersExtrasHost } from './managers-extras-host.js?v=99056e83c7d5';
import { createStrictMathHost } from './strict-math-host.js?v=99056e83c7d5';
import { createLocaleExtrasHost } from './locale-extras-host.js?v=99056e83c7d5';
import { createUnicodeHost } from './unicode-host.js?v=99056e83c7d5';
import { createMessageFormatHost } from './message-format-host.js?v=99056e83c7d5';
import { createSettingsHost } from './settings-host.js?v=99056e83c7d5';
import { createHardwareServicesHost } from './hardware-services-host.js?v=99056e83c7d5';
import { createPeripheralServicesHost } from './peripheral-services-host.js?v=99056e83c7d5';
import { createStorageServicesHost } from './storage-services-host.js?v=99056e83c7d5';
import { createSystemManagersHost } from './system-managers-host.js?v=99056e83c7d5';
import { createJavaServicesHost } from './java-services-host.js?v=99056e83c7d5';
import { DEVICE_FEATURES } from './service-kit.js?v=99056e83c7d5';
import { createTypefaceBuilderHost } from './typeface-builder-host.js?v=99056e83c7d5';
import { createViewTouchHost } from './view-touch-host.js?v=99056e83c7d5';
import { createMagnifierHost } from './magnifier-host.js?v=99056e83c7d5';
import { createDisplayHost } from './display-host.js?v=99056e83c7d5';
import { createNotificationHost } from './notification-host.js?v=99056e83c7d5';
import { createDatabaseSupportHost } from './database-support-host.js?v=99056e83c7d5';
import { VMClock } from './vm-clock.js?v=99056e83c7d5';
import { createWindowInsetsHost } from './window-insets-host.js?v=99056e83c7d5';
import { createAccessibilityServiceHost } from './accessibility-service-host.js?v=99056e83c7d5';
import { createViewLayoutHost } from './view-layout-host.js?v=99056e83c7d5';
import { createInputMethodServiceHost } from './input-method-service-host.js?v=99056e83c7d5';
import { createAutofillServiceHost } from './autofill-service-host.js?v=99056e83c7d5';
import { createClipboardServiceHost } from './clipboard-service-host.js?v=99056e83c7d5';
import { createViewInputHost } from './view-input-host.js?v=99056e83c7d5';
import { AndroidStyleBackend, STYLE_METHODS } from './android-style-backend.js?v=99056e83c7d5';
import { maybeCollect, ephemeronMap } from './heap-gc.js?v=99056e83c7d5';

const ACTIVITY = 'Landroid/app/Activity;', INTENT = 'Landroid/content/Intent;', BUNDLE = 'Landroid/os/Bundle;';
const APPLICATION = 'Landroid/app/Application;', APP_CONTEXT = 'Landroid/app/ContextImpl;';
const CONTEXTS = [ACTIVITY, APPLICATION, APP_CONTEXT, 'Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;'];
const KEYS = new Set();
const UI_FIRST_BEHIND_MS = 2000, DRAIN_HOST_BUDGET_MS = 30;
const FRAGMENT_CALLBACKS = 'Landroid/app/FragmentManager$FragmentLifecycleCallbacks;', FRAGMENT = 'Landroid/app/Fragment;', FRAGMENT_MANAGER = 'Landroid/app/FragmentManager;', TRANSACTION = 'Landroid/app/FragmentTransaction;';
const LOCALE = 'Ljava/util/Locale;', LOCALES = 'Landroid/os/LocaleList;';
const PACKAGE_MANAGER = 'Landroid/content/pm/PackageManager;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;', ACTIVITY_INFO = 'Landroid/content/pm/ActivityInfo;', COMPONENT = 'Landroid/content/ComponentName;';
const CONFIGURATION = 'Landroid/content/res/Configuration;', METRICS = 'Landroid/util/DisplayMetrics;';
const INFLATER = 'Landroid/view/LayoutInflater;', ATTRIBUTES = 'Lapkweb/bridge/AttributeSet;';
const WINDOW = 'Landroid/view/Window;', PORTER_MODE = 'Landroid/graphics/PorterDuff$Mode;';
const LAYOUT_PARAMS = 'Landroid/view/ViewGroup$LayoutParams;', MARGIN_PARAMS = 'Landroid/view/ViewGroup$MarginLayoutParams;';
const EDITABLE = 'Lapkweb/bridge/Editable;';
const PROCESS_INFO = 'Landroid/app/ActivityManager$RunningAppProcessInfo;';
const KEY_SET = 'Lapkweb/bridge/BundleKeySet;', KEY_ITERATOR = 'Lapkweb/bridge/BundleKeyIterator;';
function add(owner, signatures) { for (const signature of signatures) KEYS.add(`${owner}->${signature}`); }
for (const owner of CONTEXTS) add(owner, ['createConfigurationContext(Landroid/content/res/Configuration;)Landroid/content/Context;', 'isRestricted()Z', 'getClassLoader()Ljava/lang/ClassLoader;', 'getSystemService(Ljava/lang/String;)Ljava/lang/Object;', 'getSystemService(Ljava/lang/Class;)Ljava/lang/Object;', 'getSystemServiceName(Ljava/lang/Class;)Ljava/lang/String;', 'getPackageManager()Landroid/content/pm/PackageManager;', 'getApplicationInfo()Landroid/content/pm/ApplicationInfo;', 'getApplicationContext()Landroid/content/Context;', 'getPackageName()Ljava/lang/String;', 'getResources()Landroid/content/res/Resources;', 'getString(I)Ljava/lang/String;', 'getText(I)Ljava/lang/CharSequence;', 'startActivity(Landroid/content/Intent;)V']);
add('Landroid/app/ActivityThread;', ['currentApplication()Landroid/app/Application;']);
add(ACTIVITY, ['onConfigurationChanged(Landroid/content/res/Configuration;)V']);
add(ACTIVITY, ['getWindowManager()Landroid/view/WindowManager;', 'getOnBackInvokedDispatcher()Landroid/window/OnBackInvokedDispatcher;', 'registerActivityLifecycleCallbacks(Landroid/app/Application$ActivityLifecycleCallbacks;)V', 'unregisterActivityLifecycleCallbacks(Landroid/app/Application$ActivityLifecycleCallbacks;)V']);
add(ACTIVITY, ['setResult(I)V', 'setResult(ILandroid/content/Intent;)V', 'startActivityForResult(Landroid/content/Intent;I)V', 'startActivityForResult(Landroid/content/Intent;ILandroid/os/Bundle;)V', 'onActivityResult(IILandroid/content/Intent;)V', 'onCreateView(Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', 'onCreateView(Landroid/view/View;Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', 'getTitle()Ljava/lang/CharSequence;', 'setTitle(Ljava/lang/CharSequence;)V', 'setTitle(I)V', 'getWindow()Landroid/view/Window;', 'getFragmentManager()Landroid/app/FragmentManager;', 'getLastNonConfigurationInstance()Ljava/lang/Object;', 'onRetainNonConfigurationInstance()Ljava/lang/Object;', 'isChangingConfigurations()Z', 'isDestroyed()Z', 'recreate()V', 'onPostResume()V', 'onRestart()V', 'onStart()V', 'onResume()V', 'onPause()V', 'onStop()V', 'onDestroy()V', 'onSaveInstanceState(Landroid/os/Bundle;)V', 'onRestoreInstanceState(Landroid/os/Bundle;)V', 'onPostCreate(Landroid/os/Bundle;)V']);
add(FRAGMENT, ['<init>()V', 'getActivity()Landroid/app/Activity;', 'getContext()Landroid/content/Context;', 'getFragmentManager()Landroid/app/FragmentManager;', 'setArguments(Landroid/os/Bundle;)V', 'getArguments()Landroid/os/Bundle;', 'setRetainInstance(Z)V', 'getRetainInstance()Z', 'isAdded()Z', 'getView()Landroid/view/View;', 'onCreateView(Landroid/view/LayoutInflater;Landroid/view/ViewGroup;Landroid/os/Bundle;)Landroid/view/View;', 'onViewCreated(Landroid/view/View;Landroid/os/Bundle;)V', 'onDestroyView()V', 'onAttach(Landroid/content/Context;)V', 'onAttach(Landroid/app/Activity;)V', 'onCreate(Landroid/os/Bundle;)V', 'onActivityCreated(Landroid/os/Bundle;)V', 'onStart()V', 'onResume()V', 'onPause()V', 'onStop()V', 'onDestroy()V', 'onDetach()V', 'getTag()Ljava/lang/String;', 'getId()I', 'isHidden()Z', 'isVisible()Z', 'isDetached()Z', 'isRemoving()Z', 'isResumed()Z', 'getParentFragment()Landroid/app/Fragment;', 'getChildFragmentManager()Landroid/app/FragmentManager;', 'getResources()Landroid/content/res/Resources;', 'getString(I)Ljava/lang/String;', 'getString(I[Ljava/lang/Object;)Ljava/lang/String;', 'startActivity(Landroid/content/Intent;)V', 'startActivityForResult(Landroid/content/Intent;I)V', 'onActivityResult(IILandroid/content/Intent;)V', 'onHiddenChanged(Z)V', 'onSaveInstanceState(Landroid/os/Bundle;)V', 'onConfigurationChanged(Landroid/content/res/Configuration;)V', 'onDestroyOptionsMenu()V', 'setHasOptionsMenu(Z)V', 'setUserVisibleHint(Z)V', 'getUserVisibleHint()Z']);
add(FRAGMENT_MANAGER, ['findFragmentByTag(Ljava/lang/String;)Landroid/app/Fragment;', 'beginTransaction()Landroid/app/FragmentTransaction;', 'executePendingTransactions()Z', 'isDestroyed()Z', 'registerFragmentLifecycleCallbacks(Landroid/app/FragmentManager$FragmentLifecycleCallbacks;Z)V', 'unregisterFragmentLifecycleCallbacks(Landroid/app/FragmentManager$FragmentLifecycleCallbacks;)V', 'findFragmentById(I)Landroid/app/Fragment;', 'getFragments()Ljava/util/List;', 'getBackStackEntryCount()I', 'popBackStack()V', 'popBackStackImmediate()Z', 'popBackStack(Ljava/lang/String;I)V', 'popBackStackImmediate(Ljava/lang/String;I)Z', 'popBackStack(II)V', 'popBackStackImmediate(II)Z']);
add(TRANSACTION, ['add(ILandroid/app/Fragment;Ljava/lang/String;)Landroid/app/FragmentTransaction;', 'add(Landroid/app/Fragment;Ljava/lang/String;)Landroid/app/FragmentTransaction;', 'remove(Landroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'add(ILandroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'replace(ILandroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'replace(ILandroid/app/Fragment;Ljava/lang/String;)Landroid/app/FragmentTransaction;', 'hide(Landroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'show(Landroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'attach(Landroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'detach(Landroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'addToBackStack(Ljava/lang/String;)Landroid/app/FragmentTransaction;', 'setCustomAnimations(II)Landroid/app/FragmentTransaction;', 'setCustomAnimations(IIII)Landroid/app/FragmentTransaction;', 'setTransition(I)Landroid/app/FragmentTransaction;', 'setReorderingAllowed(Z)Landroid/app/FragmentTransaction;', 'isAddToBackStackAllowed()Z', 'disallowAddToBackStack()Landroid/app/FragmentTransaction;', 'isEmpty()Z', 'commit()I', 'commitAllowingStateLoss()I', 'commitNow()V', 'commitNowAllowingStateLoss()V']);
add(APPLICATION, ['<init>()V', 'onCreate()V', 'registerActivityLifecycleCallbacks(Landroid/app/Application$ActivityLifecycleCallbacks;)V', 'unregisterActivityLifecycleCallbacks(Landroid/app/Application$ActivityLifecycleCallbacks;)V']);
add('Landroid/content/ContextWrapper;', ['<init>(Landroid/content/Context;)V', 'attachBaseContext(Landroid/content/Context;)V', 'getBaseContext()Landroid/content/Context;']);
add(ACTIVITY, ['getApplication()Landroid/app/Application;', '<init>()V', 'onCreate(Landroid/os/Bundle;)V', 'setContentView(I)V', 'setContentView(Landroid/view/View;)V', 'setContentView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V', 'findViewById(I)Landroid/view/View;', 'getIntent()Landroid/content/Intent;', 'setIntent(Landroid/content/Intent;)V', 'finish()V', 'isFinishing()Z', 'onBackPressed()V']);
add('Landroid/view/View;', ['saveAttributeDataForStyleable(Landroid/content/Context;[ILandroid/util/AttributeSet;Landroid/content/res/TypedArray;II)V', 'isForegroundInsidePadding()Z', 'getForegroundGravity()I', 'setForegroundGravity(I)V', 'setSaveFromParentEnabled(Z)V', 'isSaveFromParentEnabled()Z', 'setSaveEnabled(Z)V', 'isSaveEnabled()Z', 'hasOnClickListeners()Z', 'setImportantForAutofill(I)V', 'getImportantForAutofill()I', 'isLaidOut()Z', 'getId()I', 'setId(I)V', 'findViewById(I)Landroid/view/View;', 'getContext()Landroid/content/Context;', 'setEnabled(Z)V', 'isEnabled()Z', 'setPadding(IIII)V', 'getPaddingLeft()I', 'getPaddingTop()I', 'getPaddingRight()I', 'getPaddingBottom()I']);
for (const owner of ['Landroid/widget/LinearLayout;', 'Landroid/widget/TextView;', 'Landroid/widget/Button;']) add(owner, ['<init>(Landroid/content/Context;)V']);
add('Landroid/widget/TextView;', ['getFilters()[Landroid/text/InputFilter;', 'setFilters([Landroid/text/InputFilter;)V']);
add('Landroid/widget/TextView;', ['getTypeface()Landroid/graphics/Typeface;', 'setTypeface(Landroid/graphics/Typeface;)V', 'setTypeface(Landroid/graphics/Typeface;I)V', 'getTransformationMethod()Landroid/text/method/TransformationMethod;', 'setTransformationMethod(Landroid/text/method/TransformationMethod;)V', 'setText(I)V', 'getText()Ljava/lang/CharSequence;', 'setTextColor(I)V', 'setTextSize(IF)V']);
add('Landroid/content/res/Resources;', ['getString(I)Ljava/lang/String;', 'getText(I)Ljava/lang/CharSequence;', 'getInteger(I)I', 'getBoolean(I)Z', 'getColor(I)I', 'getColor(ILandroid/content/res/Resources$Theme;)I', 'getDimension(I)F', 'getDimensionPixelSize(I)I', 'getDimensionPixelOffset(I)I', 'getResourcePackageName(I)Ljava/lang/String;', 'getIdentifier(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)I', 'getResourceName(I)Ljava/lang/String;', 'getResourceEntryName(I)Ljava/lang/String;', 'getResourceTypeName(I)Ljava/lang/String;', 'getStringArray(I)[Ljava/lang/String;', 'getTextArray(I)[Ljava/lang/CharSequence;', 'getIntArray(I)[I']);
add(INTENT, ['setExtrasClassLoader(Ljava/lang/ClassLoader;)V', 'setComponent(Landroid/content/ComponentName;)Landroid/content/Intent;', 'getComponent()Landroid/content/ComponentName;', 'setPackage(Ljava/lang/String;)Landroid/content/Intent;', 'getPackage()Ljava/lang/String;', 'addCategory(Ljava/lang/String;)Landroid/content/Intent;', 'hasCategory(Ljava/lang/String;)Z', 'removeCategory(Ljava/lang/String;)V', 'getScheme()Ljava/lang/String;']);
add(INTENT, ['getCategories()Ljava/util/Set;', 'resolveTypeIfNeeded(Landroid/content/ContentResolver;)Ljava/lang/String;', 'getData()Landroid/net/Uri;', 'getDataString()Ljava/lang/String;', 'setData(Landroid/net/Uri;)Landroid/content/Intent;', 'setDataAndType(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;', 'getType()Ljava/lang/String;', 'setType(Ljava/lang/String;)Landroid/content/Intent;', '<init>(Ljava/lang/String;Landroid/net/Uri;)V', '<init>()V', '<init>(Landroid/content/Context;Ljava/lang/Class;)V', '<init>(Ljava/lang/String;)V', '<init>(Landroid/content/Intent;)V', 'setClass(Landroid/content/Context;Ljava/lang/Class;)Landroid/content/Intent;', 'setClassName(Landroid/content/Context;Ljava/lang/String;)Landroid/content/Intent;', 'setClassName(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;', 'getAction()Ljava/lang/String;', 'setAction(Ljava/lang/String;)Landroid/content/Intent;', 'getFlags()I', 'setFlags(I)Landroid/content/Intent;', 'addFlags(I)Landroid/content/Intent;', 'hasExtra(Ljava/lang/String;)Z', 'removeExtra(Ljava/lang/String;)V', 'getExtras()Landroid/os/Bundle;', 'putExtras(Landroid/os/Bundle;)Landroid/content/Intent;', 'replaceExtras(Landroid/os/Bundle;)Landroid/content/Intent;']);
add(PROCESS_INFO, ['<init>()V', '<init>(Ljava/lang/String;I[Ljava/lang/String;)V']);
add('Landroid/app/ActivityManager;', ['getMyMemoryState(Landroid/app/ActivityManager$RunningAppProcessInfo;)V']);
add(ACTIVITY, ['getLocalClassName()Ljava/lang/String;', 'getComponentName()Landroid/content/ComponentName;', 'getLayoutInflater()Landroid/view/LayoutInflater;']);
for (const owner of ['Landroid/view/View;', 'Landroid/view/ViewGroup;', ...['LinearLayout', 'FrameLayout', 'ScrollView', 'TextView', 'Button', 'EditText', 'CheckBox', 'Switch', 'ProgressBar'].map(name => `Landroid/widget/${name};`)]) add(owner, ['<init>(Landroid/content/Context;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;I)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;II)V']);
add('Landroid/content/res/Resources;', ['getConfiguration()Landroid/content/res/Configuration;', 'getDisplayMetrics()Landroid/util/DisplayMetrics;', 'updateConfiguration(Landroid/content/res/Configuration;Landroid/util/DisplayMetrics;)V']);
add(PACKAGE_MANAGER, ['getServiceInfo(Landroid/content/ComponentName;I)Landroid/content/pm/ServiceInfo;', 'getActivityInfo(Landroid/content/ComponentName;I)Landroid/content/pm/ActivityInfo;', 'getApplicationInfo(Ljava/lang/String;I)Landroid/content/pm/ApplicationInfo;', 'hasSystemFeature(Ljava/lang/String;)Z', 'hasSystemFeature(Ljava/lang/String;I)Z']);
add(COMPONENT, ['<init>(Landroid/content/Context;Ljava/lang/Class;)V', '<init>(Landroid/content/Context;Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;)V', 'getClassName()Ljava/lang/String;', 'getPackageName()Ljava/lang/String;', 'flattenToString()Ljava/lang/String;', 'flattenToShortString()Ljava/lang/String;']);
add('Landroid/view/ViewGroup;', ['onViewAdded(Landroid/view/View;)V', 'onViewRemoved(Landroid/view/View;)V', 'generateDefaultLayoutParams()Landroid/view/ViewGroup$LayoutParams;', 'generateLayoutParams(Landroid/util/AttributeSet;)Landroid/view/ViewGroup$LayoutParams;']);
add('Landroid/view/View;', ['onFinishInflate()V']);
add('Landroid/view/ViewGroup;', ['setClipChildren(Z)V', 'getClipChildren()Z', 'setClipToPadding(Z)V', 'getClipToPadding()Z']);
add('Landroid/view/View;', ['setWillNotDraw(Z)V', 'willNotDraw()Z', 'getParent()Landroid/view/ViewParent;', 'setImportantForAccessibility(I)V', 'getImportantForAccessibility()I', 'isInEditMode()Z', 'setForceDarkAllowed(Z)V', 'isForceDarkAllowed()Z', 'setImportantForContentCapture(I)V', 'getImportantForContentCapture()I', 'getContentCaptureSession()Landroid/view/contentcapture/ContentCaptureSession;', 'setViewTranslationCallback(Landroid/view/translation/ViewTranslationCallback;)V', 'clearViewTranslationCallback()V', 'getViewTranslationCallback()Landroid/view/translation/ViewTranslationCallback;', 'setWindowInsetsAnimationCallback(Landroid/view/WindowInsetsAnimation$Callback;)V', 'getUniqueDrawingId()J', 'awakenScrollBars()Z', 'awakenScrollBars(I)Z', 'awakenScrollBars(IZ)Z', 'addOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V', 'removeOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V', 'isAttachedToWindow()Z', 'onAttachedToWindow()V', 'onDetachedFromWindow()V', 'onVisibilityChanged(Landroid/view/View;I)V', 'onWindowVisibilityChanged(I)V']);
add(CONFIGURATION, ['getLayoutDirection()I', 'getLocales()Landroid/os/LocaleList;', 'setLocales(Landroid/os/LocaleList;)V', 'setLocale(Ljava/util/Locale;)V']);
add(LOCALE, ['clone()Ljava/lang/Object;', 'getScript()Ljava/lang/String;', '<init>(Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V', 'getDefault()Ljava/util/Locale;', 'forLanguageTag(Ljava/lang/String;)Ljava/util/Locale;', 'getLanguage()Ljava/lang/String;', 'getCountry()Ljava/lang/String;', 'getVariant()Ljava/lang/String;', 'toLanguageTag()Ljava/lang/String;', 'toString()Ljava/lang/String;', 'equals(Ljava/lang/Object;)Z']);
add(LOCALES, ['<init>([Ljava/util/Locale;)V', 'get(I)Ljava/util/Locale;', 'size()I', 'isEmpty()Z', 'indexOf(Ljava/util/Locale;)I', 'toLanguageTags()Ljava/lang/String;', 'getDefault()Landroid/os/LocaleList;', 'getAdjustedDefault()Landroid/os/LocaleList;', 'getEmptyLocaleList()Landroid/os/LocaleList;', 'forLanguageTags(Ljava/lang/String;)Landroid/os/LocaleList;', 'getFirstMatch([Ljava/lang/String;)Ljava/util/Locale;']);
add(CONFIGURATION, ['<init>()V', '<init>(Landroid/content/res/Configuration;)V']);
add(INFLATER, ['from(Landroid/content/Context;)Landroid/view/LayoutInflater;', 'getContext()Landroid/content/Context;', 'getFactory()Landroid/view/LayoutInflater$Factory;', 'getFactory2()Landroid/view/LayoutInflater$Factory2;', 'setFactory(Landroid/view/LayoutInflater$Factory;)V', 'setFactory2(Landroid/view/LayoutInflater$Factory2;)V', 'cloneInContext(Landroid/content/Context;)Landroid/view/LayoutInflater;', 'inflate(ILandroid/view/ViewGroup;)Landroid/view/View;', 'inflate(ILandroid/view/ViewGroup;Z)Landroid/view/View;']);
for (const owner of ['Landroid/view/ViewGroup;', 'Landroid/widget/LinearLayout;', 'Landroid/widget/FrameLayout;', 'Landroid/widget/ScrollView;']) add(owner, ['getChildAt(I)Landroid/view/View;', 'getChildCount()I', 'indexOfChild(Landroid/view/View;)I', 'removeViewAt(I)V', 'removeViews(II)V', 'addView(Landroid/view/View;)V', 'addView(Landroid/view/View;I)V', 'addView(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)V', 'addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V', 'removeView(Landroid/view/View;)V', 'removeAllViews()V']);
add(ATTRIBUTES, ['getAttributeCount()I', 'getAttributeName(I)Ljava/lang/String;', 'getAttributeNameResource(I)I', 'getAttributeValue(I)Ljava/lang/String;', 'getAttributeValue(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', 'getAttributeResourceValue(II)I', 'getAttributeResourceValue(Ljava/lang/String;Ljava/lang/String;I)I', 'getAttributeIntValue(II)I', 'getAttributeIntValue(Ljava/lang/String;Ljava/lang/String;I)I', 'getAttributeBooleanValue(IZ)Z', 'getAttributeBooleanValue(Ljava/lang/String;Ljava/lang/String;Z)Z', 'getStyleAttribute()I', 'getPositionDescription()Ljava/lang/String;']);
add(WINDOW, ['getDecorView()Landroid/view/View;', 'peekDecorView()Landroid/view/View;', 'getCallback()Landroid/view/Window$Callback;', 'setCallback(Landroid/view/Window$Callback;)V', 'findViewById(I)Landroid/view/View;', 'setContentView(Landroid/view/View;)V', 'setContentView(I)V', 'requestFeature(I)Z', 'hasFeature(I)Z']);
const PARAM_TYPES = [LAYOUT_PARAMS, MARGIN_PARAMS, 'Landroid/widget/LinearLayout$LayoutParams;', 'Landroid/widget/FrameLayout$LayoutParams;'];
for (const owner of PARAM_TYPES) add(owner, ['<init>(Landroid/content/Context;Landroid/util/AttributeSet;)V', '<init>(II)V', `<init>(${LAYOUT_PARAMS})V`]);
add(MARGIN_PARAMS, [`<init>(${MARGIN_PARAMS})V`]);
add('Landroid/widget/LinearLayout$LayoutParams;', ['<init>(IIF)V']); add(MARGIN_PARAMS, ['setMargins(IIII)V']);
add('Landroid/view/View;', ['setLayoutParams(Landroid/view/ViewGroup$LayoutParams;)V', 'getLayoutParams()Landroid/view/ViewGroup$LayoutParams;', 'setTag(ILjava/lang/Object;)V', 'getTag(I)Ljava/lang/Object;', 'setTag(Ljava/lang/Object;)V', 'getTag()Ljava/lang/Object;']);
// The android.widget / android.view class hierarchy the host views do not implement (android-13.0.0_r1 declarations): the classes exist with their real superclass chain, so an APK or
// library class that extends one loads, reflection and isAssignableFrom see View, and any use of an unimplemented widget fails on its own missing constructor or method instead of on a
// broken hierarchy. Widgets with host behaviour are in WIDGET_PARENTS below; HorizontalScrollView is the original AOSP class of the layouts profile.
const UNIMPLEMENTED_WIDGET_PARENTS = Object.fromEntries(Object.entries({
  'android/widget/HorizontalScrollView': 'android/widget/FrameLayout', 'android/widget/AbsoluteLayout': 'android/view/ViewGroup', 'android/widget/RelativeLayout': 'android/view/ViewGroup',
  'android/widget/GridLayout': 'android/view/ViewGroup', 'android/widget/TableLayout': 'android/widget/LinearLayout', 'android/widget/TableRow': 'android/widget/LinearLayout', 'android/widget/RadioGroup': 'android/widget/LinearLayout',
  'android/widget/NumberPicker': 'android/widget/LinearLayout', 'android/widget/TabWidget': 'android/widget/LinearLayout', 'android/widget/SearchView': 'android/widget/LinearLayout', 'android/widget/TabHost': 'android/widget/FrameLayout',
  'android/widget/DatePicker': 'android/widget/FrameLayout', 'android/widget/TimePicker': 'android/widget/FrameLayout', 'android/widget/CalendarView': 'android/widget/FrameLayout', 'android/widget/MediaController': 'android/widget/FrameLayout',
  'android/widget/ViewAnimator': 'android/widget/FrameLayout', 'android/widget/ViewFlipper': 'android/widget/ViewAnimator', 'android/widget/ViewSwitcher': 'android/widget/ViewAnimator', 'android/widget/TextSwitcher': 'android/widget/ViewSwitcher',
  'android/widget/ImageSwitcher': 'android/widget/ViewSwitcher', 'android/widget/AdapterView': 'android/view/ViewGroup', 'android/widget/AdapterViewAnimator': 'android/widget/AdapterView', 'android/widget/AbsListView': 'android/widget/AdapterView',
  'android/widget/ListView': 'android/widget/AbsListView', 'android/widget/GridView': 'android/widget/AbsListView', 'android/widget/ExpandableListView': 'android/widget/ListView', 'android/widget/AbsSpinner': 'android/widget/AdapterView',
  'android/widget/Spinner': 'android/widget/AbsSpinner', 'android/widget/Gallery': 'android/widget/AbsSpinner', 'android/widget/Toolbar': 'android/view/ViewGroup', 'android/widget/ImageButton': 'android/widget/ImageView',
  'android/widget/ZoomButton': 'android/widget/ImageButton', 'android/widget/QuickContactBadge': 'android/widget/ImageView', 'android/widget/RadioButton': 'android/widget/CompoundButton', 'android/widget/ToggleButton': 'android/widget/CompoundButton',
  'android/widget/CheckedTextView': 'android/widget/TextView', 'android/widget/AutoCompleteTextView': 'android/widget/EditText', 'android/widget/MultiAutoCompleteTextView': 'android/widget/AutoCompleteTextView', 'android/widget/Chronometer': 'android/widget/TextView',
  'android/widget/TextClock': 'android/widget/TextView', 'android/widget/AbsSeekBar': 'android/widget/ProgressBar', 'android/widget/SeekBar': 'android/widget/AbsSeekBar', 'android/widget/RatingBar': 'android/widget/AbsSeekBar',
  'android/widget/Space': 'android/view/View', 'android/view/SurfaceView': 'android/view/View', 'android/view/TextureView': 'android/view/View', 'android/view/ViewStub': 'android/view/View', 'android/widget/VideoView': 'android/view/SurfaceView',
}).map(([name, parent]) => [`L${name};`, `L${parent};`]));
const WIDGET_PARENTS = { FrameLayout: 'Landroid/view/ViewGroup;', ScrollView: 'Landroid/widget/FrameLayout;', EditText: 'Landroid/widget/TextView;', CompoundButton: 'Landroid/widget/Button;', CheckBox: 'Landroid/widget/CompoundButton;', Switch: 'Landroid/widget/CompoundButton;', ProgressBar: 'Landroid/view/View;' };
add('Landroid/view/ViewGroup;', ['addViewInLayout(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)Z', 'addViewInLayout(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;Z)Z', 'removeViewInLayout(Landroid/view/View;)V', 'removeAllViewsInLayout()V', 'detachViewFromParent(I)V', 'detachViewFromParent(Landroid/view/View;)V', 'detachViewsFromParent(II)V', 'detachAllViewsFromParent()V', 'attachViewToParent(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)V', 'removeDetachedView(Landroid/view/View;Z)V']);
for (const owner of ['Landroid/view/ViewParent;', 'Landroid/view/ViewGroup;']) add(owner, ['onDescendantInvalidated(Landroid/view/View;Landroid/view/View;)V', 'requestDisallowInterceptTouchEvent(Z)V']);
for (const name of Object.keys(WIDGET_PARENTS)) add(`Landroid/widget/${name};`, ['<init>(Landroid/content/Context;)V']);
add('Landroid/widget/EditText;', ['getText()Landroid/text/Editable;']);
add('Landroid/widget/TextView;', ['setText(Ljava/lang/CharSequence;)V', 'addTextChangedListener(Landroid/text/TextWatcher;)V', 'removeTextChangedListener(Landroid/text/TextWatcher;)V', 'setHint(Ljava/lang/CharSequence;)V', 'getHint()Ljava/lang/CharSequence;']);
add('Landroid/widget/CompoundButton;', ['setChecked(Z)V', 'isChecked()Z', 'toggle()V', 'setOnCheckedChangeListener(Landroid/widget/CompoundButton$OnCheckedChangeListener;)V']);
add('Landroid/widget/ProgressBar;', ['setProgress(I)V', 'getProgress()I', 'setMax(I)V', 'getMax()I', 'setIndeterminate(Z)V', 'isIndeterminate()Z']);
add('Landroid/view/View;', ['setVisibility(I)V', 'getVisibility()I', 'setBackgroundColor(I)V']);
add(EDITABLE, ['toString()Ljava/lang/String;', 'length()I', 'charAt(I)C', 'subSequence(II)Ljava/lang/CharSequence;']);
const VALUE_TYPES = new Map([['String', 'Ljava/lang/String;'], ['CharSequence', 'Ljava/lang/CharSequence;'], ['Int', 'I'], ['Long', 'J'], ['Boolean', 'Z'], ['Float', 'F'], ['Double', 'D'], ['Bundle', BUNDLE], ['PersistableBundle', 'Landroid/os/PersistableBundle;'], ['Parcelable', 'Landroid/os/Parcelable;'], ['Serializable', 'Ljava/io/Serializable;'], ['StringArray', '[Ljava/lang/String;'], ['IntArray', '[I'], ['ByteArray', '[B'], ['StringArrayList', 'Ljava/util/ArrayList;'], ['IntegerArrayList', 'Ljava/util/ArrayList;'], ['ParcelableArrayList', 'Ljava/util/ArrayList;'], ['ParcelableArray', '[Landroid/os/Parcelable;'], ['SparseParcelableArray', 'Landroid/util/SparseArray;'], ['LongArray', '[J'], ['FloatArray', '[F'], ['DoubleArray', '[D'], ['BooleanArray', '[Z'], ['CharArray', '[C'], ['ShortArray', '[S'], ['Byte', 'B'], ['Char', 'C'], ['Short', 'S'], ['Binder', 'Landroid/os/IBinder;'], ['CharSequenceArray', '[Ljava/lang/CharSequence;'], ['CharSequenceArrayList', 'Ljava/util/ArrayList;'], ['Size', 'Landroid/util/Size;'], ['SizeF', 'Landroid/util/SizeF;']]);
for (const owner of [BUNDLE, 'Landroid/os/BaseBundle;', 'Landroid/os/PersistableBundle;']) {
  add(owner, ['<init>()V', '<init>(I)V', `<init>(${BUNDLE})V`, 'size()I', 'isEmpty()Z', 'containsKey(Ljava/lang/String;)Z', 'remove(Ljava/lang/String;)V', 'clear()V', `putAll(${BUNDLE})V`, 'keySet()Ljava/util/Set;', 'get(Ljava/lang/String;)Ljava/lang/Object;', 'clone()Ljava/lang/Object;', 'deepCopy()Landroid/os/Bundle;', 'setClassLoader(Ljava/lang/ClassLoader;)V', 'getClassLoader()Ljava/lang/ClassLoader;']);
  for (const [name, type] of VALUE_TYPES) {
    add(owner, [`put${name}(Ljava/lang/String;${type})V`, `get${name}(Ljava/lang/String;)${type}`]);
    if (['String', 'Int', 'Long', 'Boolean', 'Float', 'Double', 'Byte', 'Char', 'Short', 'CharSequence'].includes(name)) add(owner, [`get${name}(Ljava/lang/String;${type})${type}`]);
    if (['Parcelable', 'ParcelableArray', 'ParcelableArrayList', 'Serializable', 'SparseParcelableArray'].includes(name)) add(owner, [`get${name}(Ljava/lang/String;Ljava/lang/Class;)${{ Parcelable: 'Ljava/lang/Object;', ParcelableArray: '[Ljava/lang/Object;' }[name] ?? type}`]);   // Android 13 typed getters, erased: <T> T, <T> T[], <T extends Serializable> T
  }
}
for (const [name, type] of VALUE_TYPES) {
  add(INTENT, [`putExtra(Ljava/lang/String;${type})${INTENT}`, `get${name}Extra(Ljava/lang/String;${type})${type}`]);
  if (type.startsWith('L') || type.startsWith('[')) add(INTENT, [`get${name}Extra(Ljava/lang/String;)${type}`]);
}
add(INTENT, ['getParcelableExtra(Ljava/lang/String;Ljava/lang/Class;)Ljava/lang/Object;', 'getSerializableExtra(Ljava/lang/String;Ljava/lang/Class;)Ljava/io/Serializable;', 'getParcelableArrayExtra(Ljava/lang/String;Ljava/lang/Class;)[Ljava/lang/Object;', 'getParcelableArrayListExtra(Ljava/lang/String;Ljava/lang/Class;)Ljava/util/ArrayList;']);
add(KEY_SET, ['size()I', 'isEmpty()Z', 'contains(Ljava/lang/Object;)Z', 'remove(Ljava/lang/Object;)Z', 'clear()V', 'iterator()Ljava/util/Iterator;']);
add(KEY_ITERATOR, ['hasNext()Z', 'next()Ljava/lang/Object;', 'remove()V']);
const PARENTS = new Map([['Landroid/content/pm/PackageManager$NameNotFoundException;','Landroid/util/AndroidException;'],['Landroid/util/AndroidException;','Ljava/lang/Exception;'],[ACTIVITY, 'Landroid/view/ContextThemeWrapper;'], ['Landroid/view/ContextThemeWrapper;', 'Landroid/content/ContextWrapper;'], ['Landroid/content/ContextWrapper;', 'Landroid/content/Context;'], ['Landroid/content/Context;', 'Ljava/lang/Object;'], [INTENT, 'Ljava/lang/Object;'], [BUNDLE, 'Landroid/os/BaseBundle;'], ['Landroid/os/PersistableBundle;', 'Landroid/os/BaseBundle;'], ['Landroid/os/BaseBundle;', 'Ljava/lang/Object;'], ['Landroid/content/res/Resources;', 'Ljava/lang/Object;']]);
PARENTS.set(APPLICATION, 'Landroid/content/ContextWrapper;'); PARENTS.set(APP_CONTEXT, 'Landroid/content/Context;');
for (const type of [FRAGMENT, FRAGMENT_MANAGER, TRANSACTION]) PARENTS.set(type, 'Ljava/lang/Object;');
for (const [type, parent] of Object.entries(UNIMPLEMENTED_WIDGET_PARENTS)) PARENTS.set(type, parent);
for (const [name, parent] of Object.entries(WIDGET_PARENTS)) PARENTS.set(`Landroid/widget/${name};`, parent); PARENTS.set(LOCALE, 'Ljava/lang/Object;'); PARENTS.set(LOCALES, 'Ljava/lang/Object;'); PARENTS.set('Landroid/os/Parcelable$ClassLoaderCreator;', 'Landroid/os/Parcelable$Creator;');
PARENTS.set('Landroid/content/pm/ComponentInfo;', 'Landroid/content/pm/PackageItemInfo;'); PARENTS.set('Landroid/content/pm/PackageItemInfo;', 'Ljava/lang/Object;');
PARENTS.set(PACKAGE_MANAGER, 'Ljava/lang/Object;'); PARENTS.set(COMPONENT, 'Ljava/lang/Object;'); for (const [type, parent] of Object.entries(PACKAGE_VALUE_PARENTS)) PARENTS.set(type, parent); for (const name of ['Secure', 'System', 'Global']) PARENTS.set(`Landroid/provider/Settings$${name};`, 'Landroid/provider/Settings$NameValueTable;');
PARENTS.set(CONFIGURATION, 'Ljava/lang/Object;'); PARENTS.set(METRICS, 'Ljava/lang/Object;');
PARENTS.set(INFLATER, 'Ljava/lang/Object;'); PARENTS.set(ATTRIBUTES, 'Landroid/util/AttributeSet;');
PARENTS.set(WINDOW, 'Ljava/lang/Object;'); PARENTS.set(PORTER_MODE, 'Ljava/lang/Enum;');
PARENTS.set('Landroid/view/ViewGroup;', 'Landroid/view/View;'); PARENTS.set('Landroid/widget/LinearLayout;', 'Landroid/view/ViewGroup;');
PARENTS.set(LAYOUT_PARAMS, 'Ljava/lang/Object;'); PARENTS.set(MARGIN_PARAMS, LAYOUT_PARAMS); PARENTS.set('Landroid/widget/LinearLayout$LayoutParams;', MARGIN_PARAMS); PARENTS.set('Landroid/widget/FrameLayout$LayoutParams;', MARGIN_PARAMS);
PARENTS.set(EDITABLE, 'Landroid/text/Editable;'); PARENTS.set('Landroid/text/Editable;', 'Ljava/lang/CharSequence;');
PARENTS.set(PROCESS_INFO, 'Ljava/lang/Object;');
PARENTS.set(KEY_SET, 'Ljava/util/Set;'); PARENTS.set(KEY_ITERATOR, 'Ljava/util/Iterator;');
const descriptor = (name) => name?.startsWith('L') ? name : `L${name.replaceAll('.', '/')};`;
const sameRef = (a, b) => a != null && b != null && typeof a.ref === 'number' && a.ref === b.ref;
const nullish = (value) => value == null || value === 0;
const nullishString = (runtime, value) => nullish(value) ? null : typeof value === 'string' ? value : runtime.stringCharacters(value);
function error(message, details = {}) { throw new APKError(`Android platform: ${message}`, { kind: 'android-platform-unsupported', ...details }); }
function floatBits(value) { const bits = new DataView(new ArrayBuffer(4)); bits.setFloat32(0, value, true); return bits.getInt32(0, true); }
function bitsFloat(value) { const bits = new DataView(new ArrayBuffer(4)); bits.setInt32(0, value, true); return bits.getFloat32(0, true); }
function checkString(value, context) { if (typeof value !== 'string') error(`${context} requires a real String`); return value; }

/** Explicit local Activity/Intent/Bundle and basic XML Views subset. Never bridges AndroidX. */
// Optional mainline modules the virtual device does not install (AdServices / Privacy Sandbox, the SDK runtime): on such a device ContextImpl.getSystemService(Class) resolves no
// name for their manager classes and returns null, so an app checks for null, as it must on any device without the module. Every other unknown service class stays an explicit error.
const ABSENT_MODULE_PREFIXES = ['Landroid/adservices/', 'Landroid/app/sdksandbox/'];
const absentModuleService = type => ABSENT_MODULE_PREFIXES.some(prefix => type.startsWith(prefix));
const CORE_SERVICE_CLASSES = { 'Landroid/view/LayoutInflater;': 'layout_inflater', 'Landroid/view/WindowManager;': 'window', 'Landroid/view/accessibility/AccessibilityManager;': 'accessibility', 'Landroid/view/autofill/AutofillManager;': 'autofill', 'Landroid/content/ClipboardManager;': 'clipboard', 'Landroid/view/inputmethod/InputMethodManager;': 'input_method', 'Landroid/os/BatteryManager;': 'batterymanager', 'Landroid/net/ConnectivityManager;': 'connectivity', 'Landroid/app/job/JobScheduler;': 'jobscheduler', 'Landroid/telephony/TelephonyManager;': 'phone' };
export class AndroidPlatform {
  constructor({ resources = null, applicationName = null, packageName = null, manifest = null, apkBytes = null, device = null } = {}) { this.device = resolveDevice(device || {}); this.userDevice = this.device; this.clock = new VMClock(); this.apkBytes = apkBytes; this.manifest = manifest; this.resources = resources; this.applicationName = applicationName; this.packageName = packageName; this.application = null; this.applicationState = 'new'; this.tasks = []; this.nextTaskId = 1; this.starter = new ActivityStarter(this); this.activityInfos = new Map(); this.lastTransition = null; this.taskClosed = false; this.resourceObject = null; this.finishedActivities = new Set(); this.eventSequence = 0; this.looperHost = createLooperHost(this); this.virtualProcess = { source: 'browser-vm', pid: 1, uid: 10000, foreground: true }; this.transactionSequence = 0; this.porterModes = new Map(); this.inflaters = new Map(); this.applicationCallbacks = []; this.styleBackend = new AndroidStyleBackend(this); this.viewTreeHost = createViewTreeHost(this); this.viewWindowHost = createViewWindowHost(this); this.canvasHost = createVectorCanvasHost(); this.paintHost = createPaintHost(); this.contentHost = createContentResolverHost(this); this.drawableViewHost = createDrawableViewHost(this); this.deviceServices = createDeviceServicesHost(this); this.insetsHost = createWindowInsetsHost(this); this.accessibilityService = createAccessibilityServiceHost(this); this.viewLayoutHost = createViewLayoutHost(this); this.autofillService = createAutofillServiceHost(this); this.inputMethodService = createInputMethodServiceHost(this); this.clipboardService = createClipboardServiceHost(this); this.viewInputHost = createViewInputHost(this); this.xmlHost = new AndroidXmlHost(this); this.localeService = createLocaleServiceHost(this); this.viewStateHost = createViewStateHost(); this.componentCallbacksHost = createComponentCallbacksHost(this); this.editableTextHost = createEditableTextHost(this); this.viewCoordinateHost = createViewCoordinateHost(this); this.viewTransformHost = createViewTransformHost(this); this.viewPropertyAnimatorHost = createViewPropertyAnimatorHost(this); this.viewOutlineHost = createViewOutlineHost(this); this.composeCanvasHost = createComposeCanvasHost(this); this.dialogWindowHost = createDialogWindowHost(this); this.systemServices = createSystemServicesHost(this); this.strictMode = createStrictModeHost(this); this.javaIo = createJavaIoHost(this); this.classLoaders = createClassLoaderHost(this); this.appServices = createAppServicesHost(this); this.concurrency = createConcurrencyHost(this); this.dateTime = createDateTimeHost(this); this.numberFormat = createNumberFormatHost(this); this.cookies = createCookieHost(this); this.viewApi = createViewApiHost(this); this.textViewApi = createTextViewApiHost(this); this.intentApi = createIntentApiHost(this); this.activityApi = createActivityApiHost(this); this.contentResolverApi = createContentResolverApiHost(this); this.packageManagerApi = createPackageManagerApiHost(this); this.packageValueObjects = createPackageValueObjectsHost(this); this.networkInfoHost = createNetworkInfoHost(this); this.apkChecksumsHost = createApkChecksumsHost(this); this.remoteViews = createRemoteViewsHost(this); this.miscPlatform = createMiscPlatformHost(this); this.icuText = createIcuTextHost(this); this.toasts = createToastHost(this); this.platformData = createPlatformDataClassesHost(this); this.imageDecoder = createImageDecoderHost(this); this.imageViewApi = createImageViewApiHost(this); this.progressBarApi = createProgressBarApiHost(this); this.viewGroupApi = createViewGroupApiHost(this); this.viewInternals = createViewInternalsHost(this); this.uriApi = createUriApiHost(this); this.formatter = createFormatterHost(this); this.security = createSecurityHost(this); this.jca = createJcaHost(this); this.reflection = createReflectionHost(this); this.serialization = createSerializationHost(this); this.bitmapCodec = createBitmapCodecHost(this); this.bitmapDrawable = createBitmapDrawableHost(this); this.imageView = createImageViewHost(this); this.webView = createWebViewHost(this); this.contentExtras = createContentExtrasHost(this); this.preferenceManager = createPreferenceManagerHost(this); this.processHost = createProcessHost(this); this.statsHost = createStatsHost(this); this.telephonyExtras = createTelephonyHost(this); this.surfaceTextureHost = createSurfaceTextureHost(); this.buildHost = createBuildHost(this); this.sensorHost = createSensorHost(); this.geocoderHost = createGeocoderHost(this); this.coreLangHost = createCoreLangHost(this); this.resourcesExtras = createResourcesExtrasHost(this); this.simpleTimeZone = createSimpleTimeZoneHost(this); this.activityManagerExtras = createActivityManagerExtrasHost(this); this.managersExtras = createManagersExtrasHost(this); this.strictMath = createStrictMathHost(); this.localeExtras = createLocaleExtrasHost(this); this.unicode = createUnicodeHost(this); this.messageFormat = createMessageFormatHost(this); this.settings = createSettingsHost(this); this.systemFeatures = new Set(DEVICE_FEATURES); this.hardwareServices = createHardwareServicesHost(this); this.peripheralServices = createPeripheralServicesHost(this); this.storageServices = createStorageServicesHost(this); this.systemManagers = createSystemManagersHost(this); this.javaServices = createJavaServicesHost(this); this.typefaceBuilder = createTypefaceBuilderHost(this); this.viewTouch = createViewTouchHost(this); this.magnifier = createMagnifierHost(this); this.displayHost = createDisplayHost(this); this.notifications = createNotificationHost(this); this.databaseSupport = createDatabaseSupportHost(this); this.shaderHost = createShaderHost(this); this.systemBarsHost = createSystemBarsHost(this); this.deviceState = createDeviceStateHost(this); this.jobScheduler = createJobSchedulerHost(this); this.pendingIntents = createPendingIntentHost(this); this.binderHost = createBinderHost(this); this.inputManagerHost = createInputManagerHost(this); this.backDispatcher = createBackDispatcherHost(this); this.rtAnimators = createRenderThreadAnimators(this); this.icuBidi = createIcuBidiHost(this); this.contractHosts = [this.systemServices, this.strictMode, this.javaIo, this.classLoaders, this.appServices, this.concurrency, this.looperHost, this.dateTime, this.numberFormat, this.cookies, this.viewApi, this.textViewApi, this.intentApi, this.activityApi, this.contentResolverApi, this.packageManagerApi, this.packageValueObjects, this.networkInfoHost, this.apkChecksumsHost, this.remoteViews, this.miscPlatform, this.icuText, this.toasts, this.platformData, this.imageDecoder, this.imageViewApi, this.progressBarApi, this.viewGroupApi, this.viewInternals, this.uriApi, this.formatter, this.icuBidi, this.security, this.jca, this.reflection, this.serialization, this.bitmapCodec, this.bitmapDrawable, this.imageView, this.webView, this.contentExtras, this.preferenceManager, this.processHost, this.statsHost, this.telephonyExtras, this.surfaceTextureHost, this.buildHost, this.sensorHost, this.geocoderHost, this.coreLangHost, this.resourcesExtras, this.simpleTimeZone, this.activityManagerExtras, this.managersExtras, this.strictMath, this.localeExtras, this.unicode, this.messageFormat, this.settings, this.hardwareServices, this.peripheralServices, this.storageServices, this.systemManagers, this.javaServices, this.typefaceBuilder, this.viewTouch, this.magnifier, this.displayHost, this.notifications, this.databaseSupport, this.shaderHost, this.deviceState, this.jobScheduler, this.pendingIntents, this.binderHost, this.inputManagerHost, this.backDispatcher]; }
  readStatic(runtime, field) {
    for (const host of this.contractHosts) { const hosted = host.readStatic(runtime, field); if (hosted) return hosted; }
    // Android 13 Bundle.EMPTY: one singleton whose mMap is the immutable ArrayMap.EMPTY; any insertion throws UnsupportedOperationException("ArrayMap is immutable").
    if ((field.owner === BUNDLE || field.owner === 'Landroid/os/BaseBundle;') && field.name === 'EMPTY' && field.type === BUNDLE) { this.emptyBundles ??= new WeakMap(); if (!this.emptyBundles.has(runtime)) { const value = this.bundle(runtime); runtime.object(value).immutableEmpty = true; this.emptyBundles.set(runtime, value); (runtime.hostStaticValues ??= []).push(value); } return { handled: true, value: this.emptyBundles.get(runtime) }; }
    if (field.owner === 'Landroid/view/View;' && field.type === 'Z' && ['sUseBrokenMakeMeasureSpec', 'sUseZeroUnspecifiedMeasureSpec'].includes(field.name)) { const target = Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1); return { handled: true, value: field.name === 'sUseBrokenMakeMeasureSpec' ? (target <= 17 ? 1 : 0) : (target < 23 ? 1 : 0) }; } // Original AOSP View.java compatibility assignments, derived from actual manifest target.
    if (field.owner === 'Landroid/provider/Settings$Secure;' && field.type === 'Ljava/lang/String;' && ['LONG_PRESS_TIMEOUT', 'MULTI_PRESS_TIMEOUT'].includes(field.name)) return { handled: true, value: field.name.toLowerCase() }; // Original Settings.Secure key names; values live in the VM core-settings store.
    if (field.owner === 'Landroid/os/Trace;' && field.name === 'TRACE_TAG_VIEW' && field.type === 'J') return { handled: true, value: 8n }; // AOSP Trace.java: 1L << 3
    if (field.owner === 'Landroid/view/View;' && field.type === 'Z' && field.name === 'sPreserveMarginParamsInLayoutParamConversion') return { handled: true, value: Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1) >= 24 ? 1 : 0 };
    if (field.owner === LOCALE && Object.hasOwn(LOCALE_CONSTANTS, field.name)) return { handled: true, value: this.locale(runtime, LOCALE_CONSTANTS[field.name]) };
    if (field.owner === PORTER_MODE) { const names = ['CLEAR', 'SRC', 'DST', 'SRC_OVER', 'DST_OVER', 'SRC_IN', 'DST_IN', 'SRC_OUT', 'DST_OUT', 'SRC_ATOP', 'DST_ATOP', 'XOR', 'DARKEN', 'LIGHTEN', 'MULTIPLY', 'SCREEN', 'ADD', 'OVERLAY']; if (names.includes(field.name)) { if (!this.porterModes.has(field.name)) { const ref = runtime.makeObject(PORTER_MODE); Object.assign(runtime.object(ref), { enumName: field.name, enumOrdinal: names.indexOf(field.name) }); this.porterModes.set(field.name, ref); } return { handled: true, value: this.porterModes.get(field.name) }; } }
    const build = { FINGERPRINT: 'apkweb/browser-vm/density1:28/compat/1:userdebug/test-keys', MODEL: 'APK Browser VM', MANUFACTURER: 'APK Browser Lab', BRAND: 'apkweb', DEVICE: 'browser', PRODUCT: 'browser-vm', HARDWARE: 'wasm-js', TYPE: 'userdebug', TAGS: 'test-keys', CPU_ABI: 'wasm32', CPU_ABI2: '', ID: 'APKWEB', DISPLAY: 'APKWEB browser compatibility VM' };
    if (field.owner === 'Landroid/os/Build;' && Object.hasOwn(build, field.name)) return { handled: true, value: build[field.name] };
    if (field.owner === 'Landroid/os/Build$VERSION;' && field.name === 'SDK_INT') return { handled: true, value: runtime.apiLevel };
    return null;
  }
  /** handleBindApplication. `stopAfter: 'attach'` (tests/tools) stops once Application.attach() ran; a later call continues with providers and onCreate. */
  beforeLaunch(runtime, { stopAfter = null } = {}) {
    this.vmRuntime = runtime;
    if (this.applicationState === 'initialized') return;
    if (this.applicationState === 'failed') error('Application initialization previously failed; reopen the APK');
    const type = this.applicationName ? descriptor(this.applicationName) : APPLICATION;
    if (this.applicationName && (!runtime.dex.classes.has(type) || !runtime.isSubtype(type, APPLICATION))) error(`Manifest Application is unavailable or not an Application: ${type}`);
    const resuming = this.applicationState === 'attached';
    this.applicationState = 'initializing'; if (!resuming) this.systemServices.initializeSystemProperties(runtime);
    // ActivityThread.handleBindApplication: StrictMode.initThreadDefaults / initVmDefaults(appInfo) -- the original framework StrictMode installs the process defaults (apps targeting API 11+ get
    // detectNetwork + penaltyDeathOnNetwork on the main thread, so network I/O there throws NetworkOnMainThreadException through the BlockGuard policy; N+ also get FileUriExposedException).
    if (!resuming && runtime.classes.has('Landroid/os/StrictMode;') && this.manifest) {
      const info = this.applicationInfo(runtime);
      const muted = runtime.traceMuted; runtime.traceMuted = true;   // process-start plumbing must not evict the APK-visible head of the trace
      try { for (const name of ['initThreadDefaults', 'initVmDefaults']) runtime.dispatch({ owner: 'Landroid/os/StrictMode;', name, signature: '(Landroid/content/pm/ApplicationInfo;)V', parameters: ['Landroid/content/pm/ApplicationInfo;'], result: 'V' }, [info], 'static'); } finally { runtime.traceMuted = muted; }
    }
    // The platform registers the Android Keystore providers at process start (AndroidKeyStoreProvider.install, in front of or behind Bouncy Castle). It costs a provider-list
    // initialisation, so the virtual process does it for apps whose DEX refers to the security APIs.
    if (!resuming && runtime.jni?.provider?.has('libjavacrypto.so') && runtime.classes.has('Landroid/security/keystore2/AndroidKeyStoreProvider;') && runtime.dex.types.some(t => /^L(?:java\/security|javax\/crypto|javax\/net\/ssl|android\/security|androidx\/security|org\/conscrypt|org\/bouncycastle|com\/google\/crypto)\//.test(t)))
      runtime.dispatch({ owner: 'Landroid/security/keystore2/AndroidKeyStoreProvider;', name: 'install', signature: '()V', parameters: [], result: 'V' }, [], 'static');
    try {
      if (!resuming) {
      const context = runtime.makeObject(APP_CONTEXT); runtime.object(context).packageName = this.packageName;
      this.application = runtime.allocate(type); runtime.object(this.application).baseContext = context;
      runtime.record(`APPLICATION construct ${type}`);
      runtime.dispatch({ owner: type, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [this.application], 'direct');
      runtime.dispatch({ owner: APPLICATION, name: 'attachBaseContext', signature: '(Landroid/content/Context;)V', parameters: ['Landroid/content/Context;'], result: 'V' }, [this.application, context], 'virtual');
      this.applicationAttached = true; // ActivityThread.mInitialApplication is assigned after Application.attach() and before Application.onCreate()
      }
      if (stopAfter === 'attach') { this.applicationState = 'attached'; return; }
      this.appServices.installContentProviders(runtime); // handleBindApplication: providers are installed after attach and BEFORE Application.onCreate
      runtime.dispatch({ owner: type, name: 'onCreate', signature: '()V', parameters: [], result: 'V' }, [this.application], 'virtual');
      this.applicationState = 'initialized';
    } catch (failure) { this.applicationState = 'failed'; throw failure; }
  }
  /** Why an android.widget/android.view class that only exists as a hierarchy declaration (UNIMPLEMENTED_WIDGET_PARENTS) cannot be constructed; null for every other class. */
  unimplementedWidgetMessage(type, runtime) {
    if (!Object.hasOwn(UNIMPLEMENTED_WIDGET_PARENTS, type) || runtime.classes.has(type)) return null;
    return `Unsupported widget ${type.slice(1, -1).replaceAll('/', '.')}: the lab declares the class but does not implement it, so constructing it would yield a View that cannot measure, draw or take input`;
  }
  /** SystemServiceRegistry's class -> Context.*_SERVICE name table, over every service host. */
  serviceNameForClass(type) { return CORE_SERVICE_CLASSES[type] ?? this.javaServices.serviceNameForClass(type) ?? this.appServices.serviceNameForClass(type) ?? this.hardwareServices.serviceNameForClass(type) ?? this.peripheralServices.serviceNameForClass(type) ?? this.storageServices.serviceNameForClass(type) ?? this.systemManagers.serviceNameForClass(type); }
  /** Services a phone lacks entirely: getSystemService(name) answers null (WifiP2pManager without Wi-Fi Direct, MidiManager without MIDI, CredentialManager without a provider). */
  get nullServices() { return [...this.peripheralServices.nullServices, ...this.systemManagers.nullServices]; }
  interfaces(type) { return [...this.contractHosts.flatMap(host => host.interfacesOf(type)), ...([INTENT, BUNDLE, 'Landroid/net/Uri;'].includes(type) ? ['Landroid/os/Parcelable;'] : []), ...([INTENT, BUNDLE].includes(type) ? ['Ljava/lang/Cloneable;'] : []), ...(type === 'Landroid/view/ViewGroup;' ? ['Landroid/view/ViewParent;', 'Landroid/view/ViewManager;'] : []), ...(type === ACTIVITY ? ['Landroid/view/LayoutInflater$Factory2;', 'Landroid/view/Window$Callback;', 'Landroid/view/KeyEvent$Callback;', 'Landroid/view/View$OnCreateContextMenuListener;', 'Landroid/content/ComponentCallbacks2;'] : type === 'Landroid/app/Application;' ? ['Landroid/content/ComponentCallbacks2;'] : []), ...this.xmlHost.interfaces(type), ...(this.dialogWindowHost.interfaces?.(type) || []), ...(this.insetsHost.interfaces?.(type) || []), ...(this.viewWindowHost.interfaces(type) || []), ...this.drawableViewHost.interfaces(type)]; }
  resourcesForContext(runtime, context) {
    const seen=new Set();
    while(context){if(seen.has(context.ref)||seen.size>=128)error('Cyclic resource Context chain');seen.add(context.ref);const object=runtime.object(context);if(object.contextResources)return object.contextResources;context=object.baseContext;}
    return this.resourceObject??=runtime.makeObject('Landroid/content/res/Resources;');
  }
  resourceConfiguration(runtime, resources) {
    if(resources&&runtime.object(resources).contextConfiguration)return runtime.object(resources).contextConfiguration;
    if(!this.configuration){this.configuration=runtime.classes.has(CONFIGURATION)?runtime.allocate(CONFIGURATION):runtime.makeObject(CONFIGURATION);if(runtime.classes.has(CONFIGURATION))runtime.dispatch({owner:CONFIGURATION,name:'<init>',parameters:[],result:'V',signature:'()V'},[this.configuration],'direct');this.initializeConfiguration(runtime,this.configuration);}
    return this.configuration;
  }
  createConfigurationContext(runtime, receiver, override) {
    runtime.object(override);if(!runtime.dex.bootClasses?.has(CONFIGURATION))error('Original Configuration profile is required for createConfigurationContext');
    const base=this.resourcesForContext(runtime,receiver), current=this.resourceConfiguration(runtime,base), merged=runtime.allocate(CONFIGURATION);
    runtime.dispatch({owner:CONFIGURATION,name:'<init>',parameters:[CONFIGURATION],result:'V',signature:`(${CONFIGURATION})V`},[merged,current],'direct');
    runtime.dispatch({owner:CONFIGURATION,name:'updateFrom',parameters:[CONFIGURATION],result:'I',signature:`(${CONFIGURATION})I`},[merged,override],'virtual');
    const original=this.resourceConfiguration(runtime,null), changes=runtime.dispatch({owner:CONFIGURATION,name:'diff',parameters:[CONFIGURATION],result:'I',signature:`(${CONFIGURATION})I`},[original,merged],'virtual');
    const context=runtime.makeObject(APP_CONTEXT), resources=runtime.makeObject('Landroid/content/res/Resources;');
    Object.assign(runtime.object(context),{baseContext:receiver,packageName:this.packageName,contextResources:resources});
    Object.assign(runtime.object(resources),{contextConfiguration:merged,resourceConfigurationDifference:changes});
    runtime.record(`CONTEXT configuration cloned/merged by original AOSP DEX; resource delta=0x${(changes>>>0).toString(16)}`);return context;
  }
  attachActivityContext(runtime, activity) {
    const object = runtime.object(activity); if (object.activityContextAttached) return;
    const context = runtime.makeObject(APP_CONTEXT); Object.assign(runtime.object(context), { packageName: this.packageName, outerContext: activity });
    runtime.dispatch({ owner: 'Landroid/content/ContextWrapper;', name: 'attachBaseContext', parameters: ['Landroid/content/Context;'], result: 'V', signature: '(Landroid/content/Context;)V' }, [activity, context], 'virtual');
    object.activityContextAttached = true;
    const declaration = this.manifest?.activities?.find(value => value.descriptor === object.type || value.name === object.type.slice(1,-1).replaceAll('/', '.'));
    const theme = declaration?.theme || this.manifest?.application?.theme;
    // Context/theme transport: carry the manifest choice before onCreate.
    // Resource bags are resolved by the original wrapper on first getTheme.
    if(theme){object.themeResId=theme|0;const owner='Landroid/view/ContextThemeWrapper;';if(runtime.dex.bootClasses?.has(owner))runtime.storeField(object.fields,owner+'->mThemeResource:I',theme|0);}
    // The Activity is launched in the orientation its manifest (or, after a relaunch, its record) asks for, before onCreate: the other Activities of the task catch up when they come back.
    this.refreshOrientation(runtime, this.frame(runtime, activity));
  }
  /** SCREEN_ORIENTATION_* the Activity currently asks for: its record's request, else android:screenOrientation (default UNSPECIFIED). */
  requestedOrientationOf(frame) {
    const declared = frame.record?.requestedOrientation; if (declared !== undefined) return declared;
    const declaration = this.manifest?.activities?.find(value => value.descriptor === frame.type || value.name === frame.type.slice(1, -1).replaceAll('/', '.'));
    const value = Number(declaration?.screenOrientation); return Number.isFinite(value) ? value | 0 : -1;
  }
  /** The orientation ('portrait' | 'landscape') the top Activity forces on the display, or null when the user's device orientation decides (ActivityRecord.getOrientation: BEHIND defers to the Activity below). */
  forcedOrientationFor(top) {
    const stack = (top && this.taskOf(top)?.frames) || this.frames; let index = top ? stack.indexOf(top) : -1; if (index < 0 && top) index = stack.length;
    for (let frame = top; frame; ) {
      const request = this.requestedOrientationOf(frame);
      if (request !== 3) { if (request === 14) { frame.record ??= {}; frame.record.lockedOrientation ??= this.device.orientation; return frame.record.lockedOrientation; } return forcedOrientationOf(request, this.device.orientation); }
      frame = index > 0 ? stack[--index] : null;
    }
    return null;
  }
  /** The device the Configuration is built from: the user's device with the top Activity's fixed orientation folded in. */
  effectiveDevice(user, top = this.frames.at(-1)) { const forced = this.forcedOrientationFor(top); return forced && forced !== user.orientation ? resolveDevice({ ...user, orientation: forced }) : user; }
  refreshOrientation(runtime, except = null) { return this.deviceState.apply(runtime, this.userDevice, { except }); }
  /** A stopped Activity that sat below the top while the configuration changed meets it when it comes back: onConfigurationChanged if android:configChanges covers it, else a relaunch. */
  settleConfiguration(runtime, frame) {
    const pending = frame.pendingDiff | 0; if (!pending) return frame; frame.pendingDiff = 0;
    if (!this.deviceState.needsRelaunch(frame, pending)) { runtime.dispatch({ owner: frame.type, name: 'onConfigurationChanged', signature: '(Landroid/content/res/Configuration;)V', parameters: ['Landroid/content/res/Configuration;'], result: 'V' }, [frame.activity, this.configuration], 'virtual'); return frame; }
    const task = this.taskOf(frame), at = task.frames.indexOf(frame); this.recreateActivity(runtime, frame); return task.frames[at] ?? frame;
  }
  /** Activity.moveTaskToBack: the task goes to the bottom of the recents. With another task behind it that task's top Activity resumes; with none the app leaves for the launcher (onPause, onStop); resumeTask() brings it back (onRestart, onStart, onResume). */
  moveTaskToBack(runtime, task = this.tasks.at(-1)) {
    if (!task || this.taskInBackground) return;
    const top = task.frames.at(-1);
    if (this.tasks.length > 1) {
      if (task !== this.tasks.at(-1)) { this.tasks.splice(this.tasks.indexOf(task), 1); this.tasks.unshift(task); return; }
      this.pauseForLaunch(runtime, top, false); this.tasks.pop(); this.tasks.unshift(task);
      if (this.tasks.at(-1).frames.length) this.resumeFrame(runtime, this.tasks.at(-1).frames.at(-1)); this.stopFrame(runtime, top);
      runtime.record('ACTIVITY task moved to back'); return;
    }
    if (!top) return; this.taskInBackground = true;
    if (top.lifecycleStage === 4) this.lifecycleCall(runtime, top.activity, 'onPause'); this.stopFrame(runtime, top);
    runtime.record('ACTIVITY task moved to back');
  }
  resumeTask(runtime) {
    const frame = this.frames.at(-1); if (!frame || !this.taskInBackground) return false; this.taskInBackground = false;
    if (frame.lifecycleStage === 2) this.lifecycleCall(runtime, frame.activity, 'onRestart'); if (frame.lifecycleStage <= 2) this.lifecycleCall(runtime, frame.activity, 'onStart'); this.lifecycleCall(runtime, frame.activity, 'onResume');
    runtime.record('ACTIVITY task brought to front'); return true;
  }
  // ---- Tasks (ActivityTaskManager / Task): the tasks[] list is the recents order, the last entry is the foreground task; `frames` is the foreground task's Activity stack. ----------------------------------
  get frames() { return this.tasks.at(-1)?.frames ?? []; }
  allFrames() { return this.tasks.flatMap(task => task.frames); }
  taskOf(frame) { return this.tasks.find(task => task.frames.includes(frame)) ?? null; }
  taskById(id) { return this.tasks.find(task => task.id === id) ?? null; }
  /** The task-related manifest attributes of an Activity class (launchMode, taskAffinity, noHistory, ...). */
  activityInfo(type) { let info = this.activityInfos.get(type); if (!info) this.activityInfos.set(type, info = activityInfoOf(this.manifest, this.packageName, type)); return info; }
  newTask(type, info = this.activityInfo(type), { intentKey = null, exclude = false } = {}) {
    const task = { id: this.nextTaskId++, rootAffinity: info.affinity, affinity: info.affinity, realActivity: type, intentKey, excludeFromRecents: !!exclude, frames: [], pinned: 0, lastActiveTime: this.clock.now() };
    this.tasks.push(task); this.taskClosed = false; return task;
  }
  /** An Activity the platform meets without having started it (the launcher Activity): it joins the foreground task, or founds the app's first task with the MAIN/LAUNCHER intent. */
  addFrame(runtime, frame) {
    const task = this.tasks.at(-1) ?? this.newTask(frame.type, this.activityInfo(frame.type), { intentKey: JSON.stringify(['android.intent.action.MAIN', '', '', '', '', frame.type, ['android.intent.category.LAUNCHER']]) });
    task.frames.push(frame); this.taskClosed = false;
  }
  bringTaskToFront(task) { const index = this.tasks.indexOf(task); if (index >= 0 && index !== this.tasks.length - 1) { this.tasks.splice(index, 1); this.tasks.push(task); } task.lastActiveTime = this.clock.now(); }
  removeFrame(frame) { const task = this.taskOf(frame); if (!task) return null; task.frames.splice(task.frames.indexOf(frame), 1); if (!task.frames.length && !task.pinned) this.tasks.splice(this.tasks.indexOf(task), 1); return task; }
  dropEmptyTasks() { this.tasks = this.tasks.filter(task => task.frames.length || task.pinned); }
  makeCurrent(runtime, frame) { runtime.activity = frame.activity; runtime.activityType = frame.type; runtime.root = frame.root; }
  throwAndroidRuntime(runtime, message) { runtime.throwJava('Landroid/util/AndroidRuntimeException;', message); }
  /** Runs `body` as a launch by the system (PendingIntent.send): no source Activity, so the starter forces FLAG_ACTIVITY_NEW_TASK. */
  asSystemLaunch(body) { const before = this.systemLaunch; this.systemLaunch = true; try { return body(); } finally { this.systemLaunch = before; } }
  isActivityContext(runtime, context) {
    for (let at = context, depth = 0; at && !nullish(at) && depth < 16; depth++) { const object = runtime.object(at); if (runtime.isSubtype(object.type, ACTIVITY)) return true; at = object.baseContext; }
    return false;
  }
  /** The Intent an Activity receives: a copy of the launching Intent carrying the launch flags the system computed. */
  copyIntent(runtime, intent, flags) {
    const out = runtime.makeObject(INTENT);
    Object.assign(runtime.object(out), { target: intent.target ?? null, action: intent.action ?? null, flags: flags | 0, data: intent.data ?? null, mimeType: intent.mimeType ?? null, identifier: intent.identifier ?? null, package: intent.package ?? null, component: intent.component ?? null,
      categories: intent.categories ? [...intent.categories] : undefined, clipData: intent.clipData ?? null, extras: new Map(intent.extras || []), extrasPresent: !!intent.extrasPresent || !!intent.extras?.size, extrasClassLoader: intent.extrasClassLoader ?? null });
    return out;
  }
  recordTransition(runtime, transition, source) {
    const override = source?.overrideTransition ?? null; if (source) source.overrideTransition = null;
    this.lastTransition = { ...transition, enterAnim: transition.animated && override ? override.enter : 0, exitAnim: transition.animated && override ? override.exit : 0, overridden: transition.animated && !!override };
  }
  /** The Activity instance a launch creates (ActivityThread.performLaunchActivity -> onCreate -> onStart -> onResume) inside `task`. */
  createInstance(runtime, target, delivered, task, { resultReceiver = null, requestCode = -1, flags = 0, noHistory = false } = {}) {
    const activity = runtime.allocate(target);
    const frame = { activity, type: target, root: null, intent: delivered, finished: false, resultReceiver, resultRequestCode: requestCode, launchFlags: flags, noHistory };
    this.deviceState.applyAnimatorScale(runtime, this.device.animatorScale, true);
    task.frames.push(frame); this.taskClosed = false;
    runtime.activity = activity; runtime.activityType = target; runtime.root = null;
    runtime.record(`ACTIVITY start ${target}`);
    runtime.dispatch({ owner: target, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [activity], 'direct');
    this.attachActivityContext(runtime, activity);
    this.performLifecycle(runtime, activity, 'onCreate', [null], () => runtime.dispatch({ owner: target, name: 'onCreate', signature: '(Landroid/os/Bundle;)V', parameters: ['Landroid/os/Bundle;'], result: 'V' }, [activity, null], 'virtual'));
    this.afterActivityCreate(runtime, activity);
    frame.root = runtime.root;
    if (!frame.root && this.allFrames().includes(frame)) error(`Started Activity did not provide a content View: ${target}`);
    return frame;
  }
  /** The resumed Activity about to be covered gets onUserLeaveHint (unless FLAG_ACTIVITY_NO_USER_ACTION) and onPause. */
  pauseForLaunch(runtime, frame, userLeaving) {
    if (frame.lifecycleStage !== 4) return;
    if (userLeaving) runtime.dispatch({ owner: frame.type, name: 'onUserLeaveHint', signature: '()V', parameters: [], result: 'V' }, [frame.activity], 'virtual');
    this.lifecycleCall(runtime, frame.activity, 'onPause');
  }
  /** The Activity is no longer visible: onStop; an android:noHistory / FLAG_ACTIVITY_NO_HISTORY Activity finishes once the user has left it. */
  stopFrame(runtime, frame) {
    if (frame.lifecycleStage >= 3) this.lifecycleCall(runtime, frame.activity, 'onStop');
    if (frame.noHistory && !frame.finishing && !frame.finished && !(frame.lifecycleDepth > 0) && this.allFrames().includes(frame)) this.retireFrame(runtime, frame);
  }
  deliverNewIntent(runtime, frame, intent) { runtime.dispatch({ owner: frame.type, name: 'onNewIntent', signature: '(Landroid/content/Intent;)V', parameters: [INTENT], result: 'V' }, [frame.activity, intent], 'virtual'); }
  /** An Activity comes (back) to the front: orientation / configuration catch-up, then onRestart, onStart, pending results, onNewIntent(s) and onResume (ActivityThread's NewIntentItem runs after onStart). */
  resumeFrame(runtime, frame, intents = []) {
    if (frame.lifecycleStage === 4) {   // already resumed: an Activity is always paused before it receives a new intent
      if (!intents.length) return;
      this.lifecycleCall(runtime, frame.activity, 'onPause'); for (const intent of intents) this.deliverNewIntent(runtime, frame, intent); this.lifecycleCall(runtime, frame.activity, 'onResume'); return;
    }
    this.makeCurrent(runtime, frame);
    // The Activity coming back meets the orientation / configuration that changed while it was stopped: handled in place, or relaunched (a relaunch already brings it to the resumed state).
    const task = this.taskOf(frame), at = task.frames.indexOf(frame); this.refreshOrientation(runtime); const current = this.settleConfiguration(runtime, task.frames[at] ?? frame), relaunched = current !== frame;
    this.makeCurrent(runtime, current);
    if (relaunched) { this.deliverActivityResults(runtime, current); for (const intent of intents) this.deliverNewIntent(runtime, current, intent); return; }
    // mFinished is re-checked between the steps (ActivityThread.performRestartActivity / performResumeActivity): an Activity that finishes inside onRestart / onStart / onNewIntent gets no onResume.
    if (current.lifecycleStage === 2) this.lifecycleCall(runtime, current.activity, 'onRestart'); if (!this.launchAlive(current)) return;
    if (current.lifecycleStage <= 2) this.lifecycleCall(runtime, current.activity, 'onStart'); if (!this.launchAlive(current)) return;
    this.deliverActivityResults(runtime, current); for (const intent of intents) { if (!this.launchAlive(current)) return; this.deliverNewIntent(runtime, current, intent); }
    if (!this.launchAlive(current)) return;
    this.lifecycleCall(runtime, current.activity, 'onResume');
  }
  /** Brings a task to the foreground (moveTaskToFront): the covered Activity pauses, the task's top Activity resumes, the covered one stops. */
  moveTaskToFront(runtime, task) {
    if (!task || !this.tasks.includes(task)) return;
    const front = this.tasks.at(-1), previous = front?.frames.at(-1) ?? null; this.taskInBackground = false;
    if (task === front) { if (previous && previous.lifecycleStage !== 4) this.resumeFrame(runtime, previous); return; }
    if (previous) this.pauseForLaunch(runtime, previous, true);
    this.bringTaskToFront(task); if (task.frames.length) this.resumeFrame(runtime, task.frames.at(-1));
    if (previous && this.allFrames().includes(previous)) this.stopFrame(runtime, previous);
  }
  parent(type) { return this.contractHosts.reduce((found, host) => found || host.parent(type), null) || this.systemBarsHost.parent(type) || this.dialogWindowHost.parent(type) || this.viewCoordinateHost.parent(type) || this.viewStateHost.parent(type) || this.localeService.parent(type) || this.viewWindowHost.parent(type) || this.canvasHost.parent(type) || this.paintHost.parent(type) || this.contentHost.parent(type) || this.drawableViewHost.parent(type) || this.deviceServices.parent(type) || this.insetsHost.parent(type) || this.accessibilityService.parent(type) || this.autofillService.parent(type) || this.inputMethodService.parent(type) || this.clipboardService.parent(type) || this.viewInputHost.parent(type) || PARENTS.get(type) || null; }
  /** Implicit Object parents of contract-host classes: consulted only after the VM's EXTERNAL_PARENTS table. */
  fallbackParent(type) { return this.contractHosts.reduce((found, host) => found || host.fallbackParent(type), null); }
  canAllocate(type) { if (type === 'Landroid/view/View;') return true; return this.contractHosts.some(host => host.canAllocate(type)) || this.dialogWindowHost.canAllocate(type) || this.canvasHost.canAllocate(type) || this.paintHost.canAllocate(type) || this.contentHost.canAllocate(type) || this.drawableViewHost.canAllocate(type) || [LOCALE, LOCALES, PACKAGE_MANAGER, COMPONENT, APPLICATION_INFO, ACTIVITY_INFO, CONFIGURATION, METRICS, INFLATER, ATTRIBUTES, ...PARAM_TYPES, EDITABLE, ...Object.keys(WIDGET_PARENTS).map(name => `Landroid/widget/${name};`), FRAGMENT, FRAGMENT_MANAGER, TRANSACTION, APPLICATION, APP_CONTEXT, PROCESS_INFO, INTENT, BUNDLE, 'Landroid/os/BaseBundle;', 'Landroid/os/PersistableBundle;', 'Landroid/content/res/Resources;'].includes(type); }
  supports(key) { return this.supportsUncached(key); }
  supportsUncached(key) { return this.contractHosts.some(host => host.supports(key)) || this.systemBarsHost.supports(key) || this.dialogWindowHost.supports(key) || this.viewOutlineHost.supports(key) || this.composeCanvasHost.supports(key) || this.viewTransformHost.supports(key) || this.viewPropertyAnimatorHost.supports(key) || this.viewCoordinateHost.supports(key) || this.editableTextHost.supports(key) || this.componentCallbacksHost.supports(key) || this.viewStateHost.supports(key) || this.localeService.supports(key) || this.viewWindowHost.supports(key) || this.canvasHost.supports(key) || this.paintHost.supports(key) || this.contentHost.supports(key) || this.drawableViewHost.supports(key) || this.deviceServices.supports(key) || this.insetsHost.supports(key) || this.accessibilityService.supports(key) || this.viewLayoutHost.supports(key) || this.autofillService.supports(key) || this.inputMethodService.supports(key) || this.clipboardService.supports(key) || this.viewInputHost.supports(key) || KEYS.has(key) || STYLE_METHODS.has(key) || this.viewTreeHost.supports(key) || XML_METHODS.has(key); }
  viewKind(runtime, object) {
    const kind = this.drawableViewHost.viewKind(runtime, object) ?? this.webView.viewKind(runtime, object); if (kind) return kind;
    for (const [name, containerKind] of [['ScrollView', 'scroll'], ['LinearLayout', 'linear'], ['FrameLayout', 'frame']]) if (runtime.isSubtype(object.type, `Landroid/widget/${name};`)) return containerKind;
    if (runtime.isSubtype(object.type, 'Landroid/view/ViewGroup;')) return 'group';
    if (object.type === 'Landroid/view/View;' || (runtime.dex.classes.has(object.type) || runtime.classes.has(object.type)) && runtime.isSubtype(object.type, 'Landroid/view/View;') && !['TextView', 'ProgressBar'].some(name => runtime.isSubtype(object.type, `Landroid/widget/${name};`))) return 'view';
    return null;
  }
  navigationState(runtime) { this.syncCurrent(runtime); const sourceBackHandler = !!runtime.activity && !!runtime.objectOverride(runtime.object(runtime.activity).type, 'onBackPressed()V'); return { sourceBackHandler, canGoBack: this.frames.length > 1 || this.tasks.length > 1 || sourceBackHandler, activityStack: this.frames.map((frame) => frame.type.slice(1, -1).replaceAll('/', '.')), tasks: this.tasks.map((task) => ({ id: task.id, activityStack: task.frames.map((frame) => frame.type.slice(1, -1).replaceAll('/', '.')) })), closed: this.taskClosed }; }
  frame(runtime, activity = runtime.activity) {
    let frame = this.allFrames().find((entry) => sameRef(entry.activity, activity));
    if (!frame) {
      // An Activity that already finished (or was destroyed) keeps answering from a detached record: Context calls on it work as on Android (getResources, getTheme, getSystemService, ...); platform.frame() must not register it as live again.
      if (!nullish(activity) && this.finishedActivities.has(activity.ref)) return runtime.object(activity).detachedFrame ??= { activity, type: runtime.object(activity).type, finished: true, record: {}, root: null, intent: null };
      if (nullish(activity) || !runtime.isSubtype(runtime.object(activity).type, ACTIVITY)) {
        const thread = runtime.thread?.name ?? '?', api = runtime.lastHostCall ? String(runtime.lastHostCall) : 'unknown API', top = (runtime.thread?.frames ?? []).filter(f => f.method).slice(-6).reverse().map(f => `${f.method.owner.slice(1, -1).replaceAll('/', '.')}.${f.method.name}`).join(' <- ');
        const state = nullish(activity) ? 'no Activity is current (none started yet, or the last one finished and no other is resumed)' : `${runtime.typeOf(activity).slice(1, -1).replaceAll('/', '.')} is not an Activity`;
        error(`Activity context is unavailable: ${api} needs an Activity record; ${state}; thread ${thread}${top ? '; innermost Java frames: ' + top : ''}`, { kind: 'activity-context-unavailable', api, thread });
      }
      frame = { activity, type: runtime.object(activity).type, root: sameRef(activity, runtime.activity) ? runtime.root : null, intent: null, finished: false };
      this.deviceState.applyAnimatorScale(runtime, this.device.animatorScale, true);
      this.addFrame(runtime, frame);
    }
    return frame;
  }
  syncCurrent(runtime) { if (runtime.activity) { const frame = this.frame(runtime); frame.root = runtime.root; } }
  reflectionDefinition(owner, kind, name, parameters, publicOnly) { return this.contractHosts.reduce((found, host) => found || host.reflectionDefinition(owner, kind, name, parameters), null) || this.styleBackend.reflectionDefinition(owner,kind,name,parameters,publicOnly) || this.composeCanvasHost.reflectionDefinition(owner, kind, name, parameters, publicOnly) || this.insetsHost.reflectionDefinition(owner, kind, name, parameters, publicOnly) || this.accessibilityService.reflectionDefinition(owner, kind, name, parameters, publicOnly); }
  resolveExternalField(runtime, field) {
    for (const host of this.contractHosts) { const hosted = host.resolveExternalField(runtime, field); if (hosted) return hosted; }
    if (runtime.isSubtype(field.owner, 'Landroid/view/View;') && ['mScrollX', 'mScrollY'].includes(field.name) && field.type === 'I')
      return { ...field, owner: 'Landroid/view/View;', key: `Landroid/view/View;->${field.name}:I` };
    if (runtime.isSubtype(field.owner, 'Landroid/graphics/Canvas;') &&
        (field.name === 'mNativeCanvasWrapper' && field.type === 'J' || ['mDensity', 'mScreenDensity'].includes(field.name) && field.type === 'I'))
      return { ...field, owner: 'Landroid/graphics/Canvas;', key: `Landroid/graphics/Canvas;->${field.name}:${field.type}` };
    if (runtime.isSubtype(field.owner, 'Landroid/view/View;')) {
      if (field.type === 'Z' && ['sUseBrokenMakeMeasureSpec', 'sUseZeroUnspecifiedMeasureSpec', 'sPreserveMarginParamsInLayoutParamConversion'].includes(field.name) || field.type === 'I' && ['mPaddingLeft', 'mPaddingTop', 'mPaddingRight', 'mPaddingBottom', 'mLeft', 'mTop', 'mRight', 'mBottom', 'mMinWidth', 'mMinHeight', 'mMeasuredWidth', 'mMeasuredHeight', 'mLayoutDirection'].includes(field.name) || field.type === 'Landroid/content/Context;' && field.name === 'mContext') return { ...field, owner: 'Landroid/view/View;', key: `Landroid/view/View;->${field.name}:${field.type}` };
    }
    if (runtime.isSubtype(field.owner, LAYOUT_PARAMS) && field.type === 'I') {
      const owner = ['width', 'height'].includes(field.name) ? LAYOUT_PARAMS : ['leftMargin', 'topMargin', 'rightMargin', 'bottomMargin'].includes(field.name) ? MARGIN_PARAMS : null;
      if (owner) return { ...field, owner, key: `${owner}->${field.name}:I` };
    }
    return null;
  }
  syncViewFields(runtime, receiver) {
    const view = runtime.object(receiver), fields = view.fields;
    if (!view.nativeFieldAccessors) {
      const initialPadding = { ...(view.padding || {}) }, initialContext = view.context, minimumWidth = view.minimumWidth || 0, minimumHeight = view.minimumHeight || 0;
      const padding = {}; for (const edge of ['left', 'top', 'right', 'bottom']) { const key = `Landroid/view/View;->mPadding${edge[0].toUpperCase() + edge.slice(1)}:I`; Object.defineProperty(padding, edge, { enumerable: true, get: () => fields.get(key) || 0, set: value => runtime.storeField(fields, key, value) }); }
      Object.defineProperty(view, 'padding', { enumerable: true, configurable: true, get: () => padding, set: value => { for (const edge of ['left', 'top', 'right', 'bottom']) padding[edge] = value?.[edge] || 0; } });
      for (const [property, name, type, initial] of [['context', 'mContext', 'Landroid/content/Context;', initialContext], ['minimumWidth', 'mMinWidth', 'I', minimumWidth], ['minimumHeight', 'mMinHeight', 'I', minimumHeight]]) { const key = `Landroid/view/View;->${name}:${type}`; Object.defineProperty(view, property, { enumerable: true, configurable: true, get: () => fields.get(key) ?? (type === 'I' ? 0 : null), set: value => runtime.storeField(fields, key, value) }); view[property] = initial; }
      view.padding = initialPadding; view.nativeFieldAccessors = true;
    }
    for (const edge of ['left', 'top', 'right', 'bottom']) runtime.storeField(fields, `Landroid/view/View;->mPadding${edge[0].toUpperCase() + edge.slice(1)}:I`, view.padding?.[edge] || 0);
    if (view.context) runtime.storeField(fields, 'Landroid/view/View;->mContext:Landroid/content/Context;', view.context);
    runtime.storeField(fields, 'Landroid/view/View;->mMinWidth:I', view.minimumWidth || 0); runtime.storeField(fields, 'Landroid/view/View;->mMinHeight:I', view.minimumHeight || 0);
  }
  resource(id, expected) {
    if (!this.resources) error(`Resources are unavailable for ID 0x${(Number(id) >>> 0).toString(16)}`, { kind: 'resource-unsupported', resourceId: id });
    const resolved = this.resources.resolve(id);
    if (resolved.kind === 'unresolved' || resolved.kind === 'bag' || expected && !expected.includes(resolved.kind)) error(`Resource 0x${(Number(id) >>> 0).toString(16)} cannot provide ${expected?.join('/') || 'a scalar'}: ${resolved.reason || resolved.kind}`, { kind: 'resource-unsupported', resourceId: id });
    return resolved;
  }
  typedAttribute(attribute) {
    if (attribute.kind !== 'reference') return attribute;
    const value = attribute.resolved ?? this.resource(attribute.reference);
    if (value.kind === 'unresolved' || value.kind === 'bag') error(`XML attribute ${attribute.name} has unresolved resource 0x${attribute.reference.toString(16)}: ${value.reason || value.kind}`, { kind: 'resource-unsupported', resourceId: attribute.reference });
    return value;
  }
  /** Whether the attribute belongs to R.styleable.<Class> of a class in the view's ancestry that is original framework bytecode rather than a host-modeled class. */
  ownedByOriginalClass(runtime, type, attribute) {
    if (!attribute.resourceId) return false;
    for (let current = type, guard = 0; current && guard < 32; current = runtime.parent(current), guard++) {
      if (!runtime.classes.get(current) || !current.startsWith('Landroid/') && !current.startsWith('Lcom/android/internal/')) continue;
      const simple = current.slice(current.lastIndexOf('/') + 1, -1).split('$').pop();
      let array; try { array = runtime.readStatic({ owner: 'Lcom/android/internal/R$styleable;', name: simple, type: '[I' }); } catch { continue; }
      if (array && runtime.array(array).elements.includes(attribute.resourceId | 0)) return true;
    }
    return false;
  }
  dimension(attribute, runtime, floating = false) {
    // ?attr/ references resolve against the theme of the context being inflated (set by inflate()).
    const value = attribute.kind === 'attribute' && this.inflateContext ? this.styleBackend.resolved(attribute, runtime.object(this.styleBackend.theme(runtime, this.inflateContext)).themeValues) : this.typedAttribute(attribute);
    if (value.kind === 'integer' && [-1, -2, 0].includes(value.value)) return value.value;
    if (runtime && (runtime.classes || runtime.dex.classes).has('Landroid/util/TypedValue;') && value.kind === 'dimension') { const converted = this.aospDimension(runtime, value, floating ? 'complexToDimension' : 'complexToDimensionPixelSize'); return floating ? bitsFloat(converted) : converted; }
    if (value.kind !== 'dimension' || !['dp', 'sp', 'px'].includes(value.unit)) error(`Unsupported XML dimension ${attribute.name}: ${value.kind}/${value.unit}`);
    return floating ? value.value : Math.round(value.value); // Browser viewport uses a declared density/scaledDensity of 1.
  }
  inflate(runtime, node, context, depth = 0, options = {}) {
    if (depth > 64) error('XML View depth exceeds 64');
    const names = Object.fromEntries(['LinearLayout', 'TextView', 'Button', 'FrameLayout', 'ScrollView', 'EditText', 'CheckBox', 'Switch', 'ProgressBar', 'ImageView'].map(name => [name, `Landroid/widget/${name};`]));
    const short = node.name.startsWith('android.widget.') ? node.name.slice(15) : node.name;
    let factoryView = options.existing || null;
    const installed = this.inflaters.get(context?.ref), inflater = installed ? runtime.object(installed) : null;
    if (!factoryView && inflater?.factory && !this.inFactory) {
      const attrs = runtime.makeObject(ATTRIBUTES); runtime.object(attrs).node = node; this.inFactory = true;
      try { const parameters = inflater.factory2 ? ['Landroid/view/View;', 'Ljava/lang/String;', 'Landroid/content/Context;', 'Landroid/util/AttributeSet;'] : ['Ljava/lang/String;', 'Landroid/content/Context;', 'Landroid/util/AttributeSet;']; const values = inflater.factory2 ? [null, node.name, context, attrs] : [node.name, context, attrs]; const supplied = runtime.dispatch({ owner: runtime.object(inflater.factory).type, name: 'onCreateView', signature: `(${parameters.join('')})Landroid/view/View;`, parameters, result: 'Landroid/view/View;' }, [inflater.factory, ...values], 'virtual'); if (!nullish(supplied)) factoryView = supplied; }
      finally { this.inFactory = false; }
    }
    const type = factoryView ? runtime.object(factoryView).type : names[short];
    if (!type) error(`Unsupported XML View tag <${node.name}>; custom/AndroidX Views require their real implementation`, { kind: 'xml-view-unsupported', tag: node.name });
    const value = factoryView || runtime.makeObject(type), view = runtime.object(value);
    view.max ??= 100; view.progress ??= 0; view.checked ??= false; view.visibility ??= 0; view.context = context; view.enabled ??= true; view.xmlTag = node.name; view.padding ??= { left: 0, top: 0, right: 0, bottom: 0 };
    if (view.appliedNode !== node) for (const attribute of node.attributes) {
      this.inflateContext = context;
      if (attribute.namespace === null && attribute.name === 'style' && type === names.ProgressBar && attribute.kind === 'attribute' && attribute.reference === 16842872) { view.progressStyle = 'horizontal'; continue; }
      // Other namespaces belong to subclass DEX constructors, not the framework View attributes.
      if (attribute.namespace !== 'http://schemas.android.com/apk/res/android') continue;
      if (attribute.name === 'id') { if (attribute.kind !== 'reference') error('XML android:id must be a resource reference'); view.androidId = attribute.reference; continue; }
      const typed = attribute.kind === 'attribute' ? this.styleBackend.resolved(attribute, runtime.object(this.styleBackend.theme(runtime, context)).themeValues) : this.typedAttribute(attribute);
      switch (attribute.name) {
        case 'layout_width': view.layoutWidth = this.dimension(attribute, runtime); break;
        case 'layout_height': view.layoutHeight = this.dimension(attribute, runtime); break;
        case 'layout': case 'inflatedId': case 'name': if (!runtime.classes.has(type)) error(`XML ${attribute.name} requires its actual View subclass DEX`); break; // ViewStub/custom constructor consumes these through original TypedArray.
        case 'tag': view.tag = typed.value; break;
        case 'fitsSystemWindows': view.fitsSystemWindows = !!typed.value; break; // VM content viewport excludes system bars; modeled system insets are zero.
        case 'fillViewport': view.fillViewport = !!typed.value; break;
        case 'clipChildren': case 'clipToPadding': if (!runtime.isSubtype(type, 'Landroid/view/ViewGroup;')) break; if (typed.kind !== 'boolean') error(`XML ${attribute.name} requires a boolean on ViewGroup`); view[attribute.name] = !!typed.value; break;
        case 'textStyle': view.textStyle = typed.value; break;
        case 'textAllCaps': view.textAllCaps = !!typed.value; break;
        // TextView.setTypefaceFromAttrs inputs: collected here, applied after the attribute pass (typefaceBuilder.applyTextViewFont) because a font resource needs Resources.getFont. Other Views ignore these attributes.
        case 'fontFamily': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break; (view.fontAttrs ??= {}).family = attribute.kind === 'attribute' ? (typed.id ? { kind: 'reference', reference: typed.id, resolved: typed } : typed) : attribute; break;
        case 'typeface': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break; (view.fontAttrs ??= {}).typefaceIndex = typed.value | 0; break;
        case 'textFontWeight': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break; (view.fontAttrs ??= {}).weight = typed.value | 0; break;
        case 'singleLine': view.singleLine = !!typed.value; break;
        case 'minLines': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break; if (!Number.isInteger(typed.value) || typed.value < 0) error('Invalid TextView minLines attribute'); runtime.dispatch({owner:'Landroid/widget/TextView;',name:'setMinLines',signature:'(I)V',parameters:['I'],result:'V'},[value,typed.value],'virtual'); break;
        case 'maxLines': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break; if (!Number.isInteger(typed.value) || typed.value < 0) error('Invalid TextView maxLines attribute'); view.maxLines = typed.value; break;
        case 'progressTint': if (typed.kind !== 'color') error('Only scalar progressTint is supported'); view.progressTint = typed.value; break;
        case 'src': if (attribute.kind === 'reference' && !attribute.reference) { view.imageDrawable = null; break; }   // @null
          if (attribute.kind !== 'reference') error('ImageView src requires a real resource'); view.imageDrawable = this.styleBackend.loadDrawable(runtime, attribute.reference, this.styleBackend.theme(runtime, context)); runtime.dispatch({ owner: 'Landroid/graphics/drawable/Drawable;', name: 'setCallback', signature: '(Landroid/graphics/drawable/Drawable$Callback;)V', parameters: ['Landroid/graphics/drawable/Drawable$Callback;'], result: 'V' }, [view.imageDrawable, value], 'virtual'); break;
        case 'scaleType': view.imageScaleType = typed.value; break;
        case 'contentDescription': view.contentDescription = typed.value; break;
        case 'minWidth': view.minimumWidth = this.dimension(attribute, runtime); break;
        case 'minHeight': view.minimumHeight = this.dimension(attribute, runtime); break;
        case 'includeFontPadding': view.includeFontPadding = !!typed.value; break;
        case 'hint': view.hint = typed.value; break;
        case 'inputType': view.inputType = typed.value; if (runtime.isSubtype(type, 'Landroid/widget/EditText;')) view.singleLine = (typed.value & 0x0002000f) !== 0x00020001; break;
        case 'checked': view.checked = !!typed.value; break;
        case 'progress': view.progress = typed.value; break;
        case 'max': view.max = typed.value; break;
        case 'min': if (!runtime.isSubtype(type, 'Landroid/widget/ProgressBar;')) error('XML min requires a ProgressBar'); view.xmlMin = typed.value; break;
        case 'secondaryProgress': view.xmlSecondary = typed.value; break;
        case 'indeterminate': view.indeterminate = !!typed.value; break;
        case 'visibility': view.visibility = typed.value; break;
        case 'gravity': view.gravity = typed.value; break;
        case 'layout_gravity': view.layoutGravity = typed.value; break;
        case 'layout_weight': view.weight = typed.value; break;
        case 'foregroundGravity': view.foregroundGravity = typed.value; break;
        case 'foreground': this.drawableViewHost.setForegroundFromXML(runtime, value, attribute, context); break;
        case 'background': {
          if (typed.kind === 'null' || typed.kind === 'color') { view.background = typed.kind === 'null' ? null : typed.value; break; }
          const reference = attribute.kind === 'attribute' ? this.styleBackend.resolved(attribute, runtime.object(this.styleBackend.theme(runtime, context)).themeValues, false) : attribute;
          if (reference.kind !== 'reference') error('XML background requires a color or Drawable resource');
          this.drawableViewHost.invoke(runtime, { name: 'setBackgroundResource' }, [value, reference.reference]); break;
        }
        case 'layout_margin': { const size = this.dimension(attribute, runtime); view.margin = { top: size, right: size, bottom: size, left: size }; break; }
        case 'layout_marginTop': case 'layout_marginBottom': case 'layout_marginLeft': case 'layout_marginRight': case 'layout_marginStart': case 'layout_marginEnd': { view.margin ||= {}; const edge = attribute.name.slice(13).toLowerCase(); view.margin[edge === 'start' ? 'left' : edge === 'end' ? 'right' : edge] = this.dimension(attribute, runtime); break; }
        case 'orientation': if (!runtime.isSubtype(type, names.LinearLayout)) break; /* other Views ignore android:orientation */ if (![0, 1].includes(typed.value)) error('XML orientation must be horizontal or vertical on a LinearLayout'); view.orientation = typed.value; break;
        case 'text': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break; /* only TextView reads android:text; any other View ignores it (custom views read it from the AttributeSet themselves) */ if (!['string', 'null'].includes(typed.kind)) error('XML text must resolve to a string on a TextView'); view.text = typed.value ?? ''; break;
        case 'textSize': if (type === names.LinearLayout) error('XML textSize requires TextView'); view.textSize = this.dimension(attribute, runtime, true); break;
        case 'textColor': if (typed.kind === 'string' && /^res\/color[^/]*\/[^/]+\.xml$/.test(typed.value)) { view.textColor = null; break; }   // a ColorStateList resource: resolved per state when the text is drawn
          if (typed.kind !== 'color') error('XML textColor must resolve to a color or a ColorStateList resource'); view.textColor = typed.value; break;
        case 'enabled': if (typed.kind !== 'boolean') error('XML enabled must resolve to a boolean'); view.enabled = !!typed.value; break;
        case 'padding': { const size = this.dimension(attribute, runtime); view.padding = { left: size, top: size, right: size, bottom: size }; break; }
        case 'paddingLeft': case 'paddingRight': case 'paddingTop': case 'paddingBottom': view.padding[attribute.name.slice(7).toLowerCase()] = this.dimension(attribute, runtime); break;
        // Start/end insets: the lab lays out left-to-right (a right-to-left device locale fails at the layout direction check below), so start is left and end is right, as for layout_marginStart/End.
        case 'paddingStart': case 'paddingEnd': view.padding[attribute.name === 'paddingStart' ? 'left' : 'right'] = this.dimension(attribute, runtime); break;
        case 'layoutDirection': if (![0, 2, 3].includes(typed.value)) error('XML layoutDirection="rtl" needs right-to-left layout, which the lab does not run', { kind: 'xml-attribute-unsupported', attribute: 'layoutDirection', tag: node.name }); view.layoutDirectionAttribute = typed.value; break;
        case 'textAppearance': break;   // resolved with the style: TextView size / colour / typeface read the textAppearance resource (see applyStyledTextSize and the canvas text style lookups)
        case 'scrollIndicators': runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setScrollIndicators', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, typed.value], 'virtual'); break;
        case 'scrollbarAlwaysDrawVerticalTrack': case 'scrollbarAlwaysDrawHorizontalTrack': view[attribute.name] = !!typed.value; break;   // scroll bars are not drawn by the lab; the flags are kept for the View API
        case 'textAlignment': runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setTextAlignment', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, typed.value], 'virtual'); break;
        case 'ellipsize': { if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) error('XML ellipsize requires TextView'); const at = [null, 'START', 'MIDDLE', 'END', 'MARQUEE'][typed.value]; runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'setEllipsize', signature: '(Landroid/text/TextUtils$TruncateAt;)V', parameters: ['Landroid/text/TextUtils$TruncateAt;'], result: 'V' }, [value, at ? runtime.readStatic({ owner: 'Landroid/text/TextUtils$TruncateAt;', name: at, type: 'Landroid/text/TextUtils$TruncateAt;' }) : null], 'virtual'); break; }
        case 'drawableStart': case 'drawableEnd': case 'drawableLeft': case 'drawableRight': case 'drawableTop': case 'drawableBottom': {   // TextView compound drawables: set together after the attribute pass
          if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) error(`XML ${attribute.name} requires TextView`);
          const reference = attribute.kind === 'attribute' ? this.styleBackend.resolved(attribute, runtime.object(this.styleBackend.theme(runtime, context)).themeValues, false) : attribute;
          if (reference.kind === 'null' || (reference.kind === 'reference' && !reference.reference)) { (view.xmlCompound ??= {})[attribute.name.slice(8).toLowerCase()] = null; break; }
          if (reference.kind !== 'reference') error(`XML ${attribute.name} requires a Drawable resource`);
          (view.xmlCompound ??= {})[attribute.name.slice(8).toLowerCase()] = this.styleBackend.loadDrawable(runtime, reference.reference, this.styleBackend.theme(runtime, context)); break;
        }
        case 'drawablePadding': runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'setCompoundDrawablePadding', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, this.dimension(attribute, runtime)], 'virtual'); break;
        case 'scrollbars': for (const [bit, method] of [[0x100, 'setHorizontalScrollBarEnabled'], [0x200, 'setVerticalScrollBarEnabled']]) runtime.dispatch({ owner: 'Landroid/view/View;', name: method, signature: '(Z)V', parameters: ['Z'], result: 'V' }, [value, (typed.value & bit) ? 1 : 0], 'virtual'); break;
        case 'overScrollMode': runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setOverScrollMode', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, typed.value], 'virtual'); break;
        default:
          // An attribute of the styleable of an original (DEX) widget class in this view's ancestry (AbsListView, ListView, RecycleListView, ...) is read by that class's own constructor from the AttributeSet.
          if (this.ownedByOriginalClass(runtime, type, attribute)) break;
          error(`Unsupported XML attribute android:${attribute.name} on <${node.name}>`, { kind: 'xml-attribute-unsupported', attribute: attribute.name, tag: node.name });
      }
    }
    // View constructor order: a background Drawable's padding is applied first; explicit android:padding* attributes win.
    if (node.attributes.some(attribute => attribute.name === 'background' && attribute.namespace === 'http://schemas.android.com/apk/res/android')) for (const attribute of node.attributes) {
      if (attribute.namespace !== 'http://schemas.android.com/apk/res/android') continue;
      if (attribute.name === 'padding') { const size = this.dimension(attribute, runtime); view.padding = { left: size, top: size, right: size, bottom: size }; }
      else if (['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].includes(attribute.name)) view.padding[attribute.name.slice(7).toLowerCase()] = this.dimension(attribute, runtime);
    }
    if (view.xmlCompound) {   // TextView constructor: setCompoundDrawables*WithIntrinsicBounds with the drawables the attributes named
      const c = view.xmlCompound, D = 'Landroid/graphics/drawable/Drawable;', relative = 'start' in c || 'end' in c; view.xmlCompound = null;
      const sides = relative ? [c.start ?? null, c.top ?? null, c.end ?? null, c.bottom ?? null] : [c.left ?? null, c.top ?? null, c.right ?? null, c.bottom ?? null];
      runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: relative ? 'setCompoundDrawablesRelativeWithIntrinsicBounds' : 'setCompoundDrawablesWithIntrinsicBounds', signature: `(${D}${D}${D}${D})V`, parameters: [D, D, D, D], result: 'V' }, [value, ...sides], 'virtual');
    }
    if (view.fontAttrs) {   // TextView constructor: setTypefaceFromAttrs(fontFamily typeface or name, typeface index, textStyle, textFontWeight)
      const attrs = view.fontAttrs; view.fontAttrs = null;
      const resourcesRef = runtime.dispatch({ owner: 'Landroid/content/Context;', name: 'getResources', signature: '()Landroid/content/res/Resources;', parameters: [], result: 'Landroid/content/res/Resources;' }, [context], 'virtual');
      const family = attrs.family ? this.typefaceBuilder.fontFamilyAttribute(runtime, resourcesRef, attrs.family) : { typeface: null, familyName: null };
      this.typefaceBuilder.applyTextViewFont(runtime, value, { ...family, typefaceIndex: attrs.typefaceIndex ?? -1, style: view.textStyle | 0, weight: attrs.weight ?? -1 });
    }
    view.appliedNode = node; this.syncViewFields(runtime, value); this.drawableViewHost.afterLayout(runtime, value); if (options.applyOnly) return value;
    if (!['LinearLayout', 'FrameLayout', 'ScrollView'].some(name => runtime.isSubtype(type, names[name])) && node.children.length) error(`XML ${short} cannot contain child Views`);
    if (runtime.isSubtype(type, names.ScrollView) && node.children.length > 1) error('ScrollView supports exactly one direct child');
    for (const child of node.children) { const ref = this.inflate(runtime, child, context, depth + 1); runtime.object(ref).parent = value; view.children.push(ref); }
    return value;
  }
  find(runtime, root, id, seen = new Set()) {
    if (!root) return null;
    const view = runtime.object(root); if (seen.has(view.id) || seen.size >= 4096) error('Cyclic/excessive View tree'); seen.add(view.id);
    if (view.androidId === (id >>> 0)) return root;
    // An original subclass that overrides findViewTraversal (ListView also searches its header and footer views) decides for its subtree, as View.findViewById does.
    if (runtime.objectOverride(view.type, 'findViewTraversal(I)Landroid/view/View;')) { const found = runtime.dispatch({ owner: 'Landroid/view/View;', name: 'findViewTraversal', parameters: ['I'], result: 'Landroid/view/View;', signature: '(I)Landroid/view/View;' }, [root, id], 'virtual'); return nullish(found) ? null : found; }
    for (const child of view.children) { const found = this.find(runtime, child, id, seen); if (found) return found; }
    return null;
  }
  extras(runtime, value) { const object = runtime.object(value); return object.extras ??= new Map(); }
  bundle(runtime, entries = new Map(), classLoader = null) { const value = runtime.makeObject(BUNDLE); Object.assign(runtime.object(value), { extras: new Map(entries), classLoader }); return value; }
  put(runtime, object, key, type, value) {
    checkString(key, 'Bundle/Intent key'); const entries = this.extras(runtime, object); if (runtime.object(object).immutableEmpty) runtime.throwJava('Ljava/lang/UnsupportedOperationException;', 'ArrayMap is immutable'); if (runtime.object(object).type === INTENT) runtime.object(object).extrasPresent = true;
    if (!entries.has(key) && entries.size >= 10000) error('Bundle/Intent exceeds 10000 keys');
    if (!entries.has(key)) runtime.object(object).bundleVersion = (runtime.object(object).bundleVersion || 0) + 1;
    entries.set(key, { type, value });
  }
  get(runtime, object, key, type, fallback) { const value = this.extras(runtime, object).get(checkString(key, 'Bundle/Intent key')); return value && (value.type === type || ['Ljava/lang/String;', 'Ljava/lang/CharSequence;'].includes(type) && ['Ljava/lang/String;', 'Ljava/lang/CharSequence;'].includes(value.type)) ? value.value : fallback; }
  initialIntent(runtime, frame) {
    if (!frame.intent) { frame.intent = runtime.makeObject(INTENT); const intent = runtime.object(frame.intent); intent.target = frame.type; intent.extras = new Map(); intent.extrasPresent = false; intent.extrasClassLoader = null; intent.flags = 0; }
    return frame.intent;
  }
  startActivity(runtime, intentValue, resultCaller = null, requestCode = -1, context = {}) {
    const intent = runtime.object(intentValue); this.syncCurrent(runtime);
    if (!intent.target) error(`External/implicit Intent${intent.action ? ` ${intent.action}` : ''} is unsupported; only explicit Activities packaged inside this APK can start`, { kind: 'external-intent-unsupported', action: intent.action ?? null });
    // ActivityTaskManager: a start whose caller Activity is gone (finished or destroyed, or no Activity is resumed) has no source record and runs as a new task (FLAG_ACTIVITY_NEW_TASK is forced, not an error).
    const liveSource = !nullish(runtime.activity) && !this.finishedActivities.has(runtime.activity.ref), sourceFrame = liveSource ? this.frame(runtime) : null;
    const target = descriptor(intent.target);
    if (!runtime.dex.classes.has(target) || !runtime.isSubtype(target, ACTIVITY)) error(`Intent target is not an Activity packaged in this APK: ${target}`, { kind: 'external-intent-unsupported', target });
    if (this.allFrames().length >= 32) error('Activity stack exceeds 32 frames');
    const fromActivity = context.fromActivity !== false && !this.systemLaunch && sourceFrame !== null;
    // ContextImpl.startActivity: outside an Activity context the NEW_TASK flag is mandatory (apps targeting below N or P and above).
    if (context.fromActivity === false && !this.systemLaunch && !((intent.flags | 0) & LAUNCH_FLAG.NEW_TASK)) {
      const targetSdk = Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1);
      if (targetSdk < 24 || targetSdk >= 28) this.throwAndroidRuntime(runtime, 'Calling startActivity() from outside of an Activity  context requires the FLAG_ACTIVITY_NEW_TASK flag. Is this really what you want?');
    }
    if (fromActivity && requestCode >= 0 && ((intent.flags | 0) & LAUNCH_FLAG.FORWARD_RESULT)) this.throwAndroidRuntime(runtime, 'FORWARD_RESULT_FLAG used while also requesting a result');
    // ActivityTaskManager.startActivity is asynchronous for the caller: the Intent is validated and copied (it is parceled) now, the stack change and the lifecycle run as a later
    // main-thread event, after the callback that made the call has returned. Several calls queue in order.
    const copy = this.copyIntent(runtime, intent, intent.flags | 0), batch = this.currentBatch ?? null;
    // FLAG_ACTIVITY_FORWARD_RESULT is resolved by the system at the call: the caller's result target moves to the new Activity (and the caller, which usually finishes next, no longer owes a result).
    let forward = null;
    if (fromActivity && ((intent.flags | 0) & LAUNCH_FLAG.FORWARD_RESULT)) { forward = { receiver: sourceFrame.resultReceiver ?? null, code: sourceFrame.resultRequestCode ?? -1 }; sourceFrame.resultReceiver = null; sourceFrame.resultRequestCode = -1; }
    // The queued start is counted on the caller's frame (its finish() waits for the start, and a content-less caller is not an error while it is pending); a start with no live
    // source record (the Application context, or an Activity that already finished) has no frame to wait on and is counted on the platform instead.
    if (sourceFrame) sourceFrame.pendingStarts = (sourceFrame.pendingStarts ?? 0) + 1; else this.sourcelessStarts = (this.sourcelessStarts ?? 0) + 1;
    this.queueTask(() => {
      if (sourceFrame) sourceFrame.pendingStarts--; else this.sourcelessStarts--;
      this.runStart(runtime, runtime.object(copy), target, sourceFrame, { resultCaller, requestCode, fromActivity, forward }, batch);
    }, 0, sourceFrame ? [copy, resultCaller, sourceFrame.activity] : [copy, resultCaller]);
  }
  /** True while a startActivity() call is queued (the caller may legitimately have no content View: it hands over to the next screen). */
  launchPending() { return (this.sourcelessStarts ?? 0) > 0 || this.allFrames().some(frame => frame.pendingStarts > 0); }
  /** startActivities(): the later Intents start from the Activity the earlier ones created. */
  startBatch(body) { const before = this.currentBatch; this.currentBatch = { last: null }; try { return body(); } finally { this.currentBatch = before; } }
  runStart(runtime, intent, target, sourceFrame, options, batch) {
    const live = frame => frame && !frame.finished && !frame.finishing && this.allFrames().includes(frame);
    let source = batch && live(batch.last) ? batch.last : live(sourceFrame) ? sourceFrame : this.tasks.at(-1)?.frames.at(-1) ?? null;
    if (!source) options = { ...options, fromActivity: false };
    if (options.resultCaller && !this.allFrames().some(frame => sameRef(frame.activity, options.resultCaller))) options = { ...options, resultCaller: null, requestCode: -1 };
    this.starter.start(runtime, intent, target, source, options);
    if (batch) batch.last = this.tasks.at(-1)?.frames.at(-1) ?? null;
  }
  deliverActivityResults(runtime, frame) {
    while (frame.pendingActivityResults?.length) {
      const result = frame.pendingActivityResults.shift(); runtime.record(`ACTIVITY result ${result.requestCode} code ${result.resultCode}`);
      const fragment = frame.fragmentRequests?.get(result.requestCode);   // Activity.dispatchActivityResult: a request made by startActivityFromFragment goes to that Fragment instead of the Activity
      if (fragment) { frame.fragmentRequests.delete(result.requestCode); runtime.dispatch({ owner: FRAGMENT, name: 'onActivityResult', signature: '(IILandroid/content/Intent;)V', parameters: ['I', 'I', INTENT], result: 'V' }, [fragment, result.requestCode, result.resultCode, result.data], 'virtual'); continue; }
      runtime.dispatch({ owner: ACTIVITY, name: 'onActivityResult', signature: '(IILandroid/content/Intent;)V', parameters: ['I', 'I', INTENT], result: 'V' }, [frame.activity, result.requestCode, result.resultCode, result.data], 'virtual');
    }
  }
  /** The teardown of one Activity: result captured, onPause / onStop / onDestroy as its state needs, removed from its task, the result handed to the Activity that asked for it. */
  retireFrame(runtime, frame) {
    const activity = frame.activity;
    frame.finishing = true;
    const state = runtime.object(activity); let data = state.activityResultData ?? null;
    if (data) { const copy = runtime.allocate(INTENT); runtime.dispatch({ owner: INTENT, name: '<init>', signature: '(Landroid/content/Intent;)V', parameters: [INTENT], result: 'V' }, [copy, data], 'direct'); data = copy; }
    const result = { requestCode: frame.resultRequestCode, resultCode: state.activityResultCode ?? 0, data };
    if (frame.lifecycleStage === 4) this.lifecycleCall(runtime, frame.activity, 'onPause'); if (frame.lifecycleStage >= 3) this.lifecycleCall(runtime, frame.activity, 'onStop'); this.lifecycleCall(runtime, frame.activity, 'onDestroy');
    frame.finished = true; this.finishedActivities.add(frame.activity.ref); this.removeFrame(frame);
    const receiver = frame.resultReceiver && this.allFrames().find(candidate => sameRef(candidate.activity, frame.resultReceiver)); if (receiver) (receiver.pendingActivityResults ||= []).push(result);
    runtime.record(`ACTIVITY finish ${frame.type}`);
  }
  /** Finishes several Activities at once (finishAffinity, finishAndRemoveTask, navigateUpTo): the ones that are not on top go first so that nothing in between is resumed; the top one last brings the survivor to the front. */
  finishFrames(runtime, frames) {
    const current = this.tasks.at(-1)?.frames.at(-1), list = frames.filter(frame => this.allFrames().includes(frame));
    if (list.includes(current) && !current.lifecycleDepth) this.pauseForLaunch(runtime, current, false);   // the resumed Activity pauses first, as in ActivityRecord.finishIfPossible
    for (const frame of list) if (frame !== current && this.allFrames().includes(frame)) this.finish(runtime, frame.activity);
    if (list.includes(current) && this.allFrames().includes(current)) this.finish(runtime, current.activity);
  }
  finish(runtime, activity) {
    this.syncCurrent(runtime);
    const frame = this.allFrames().find(frame => sameRef(frame.activity, activity));
    if (!frame) { if (this.finishedActivities.has(activity.ref)) return; error('finish() receiver is not a registered Activity'); }
    if (frame.finishing) return;
    // finish() inside onCreate/onStart/onResume (a splash that starts the next screen): ActivityThread finishes the activity after that callback returns (onCreate -> onDestroy), so
    // the teardown waits for the outermost lifecycle callback; isFinishing() is already true.
    if (frame.lifecycleDepth > 0) { frame.finishRequested = true; return; }
    // startActivity() calls this Activity made are still queued: the finish takes effect after them (the new Activity launches, then this one stops and is destroyed).
    if (frame.pendingStarts > 0) { if (!frame.finishQueued) { frame.finishQueued = true; this.queueTask(() => { frame.finishQueued = false; if (this.allFrames().includes(frame)) this.finish(runtime, activity); }, 0, [activity]); } return; }
    const wasCurrent = sameRef(runtime.activity, activity), overrides = frame.overrideTransition ?? null;
    this.retireFrame(runtime, frame);
    this.lastTransition = { kind: 'close', animated: true, from: frame.type, to: null, enterAnim: overrides ? overrides.enter : 0, exitAnim: overrides ? overrides.exit : 0, overridden: !!overrides };
    if (!wasCurrent) return; // A previous Splash may finish after starting a child.
    const previous = this.frames.at(-1);
    if (previous) this.resumeFrame(runtime, previous);
    else { runtime.activity = null; runtime.activityType = null; runtime.root = null; this.taskClosed = true; }
  }

  viewRoots(runtime) { return this.dialogWindowHost.roots(runtime); }
  back(runtime) { if(this.dialogWindowHost.back(runtime))return; if (!runtime.activity) error('No active Activity to navigate back from'); if (this.backDispatcher.dispatchBack(runtime, runtime.activity)) return; return runtime.dispatch({ owner: ACTIVITY, name: 'onBackPressed', signature: '()V', parameters: [], result: 'V' }, [runtime.activity], 'virtual'); }
  /** Does any host of the dispatch chain in invoke() claim this method? Memoised per key: most bridged calls (collections, atomics, threads) are claimed by none, and asking about fifty hosts cost more than the call. */
  chainTouches(key) {
    if (this.chainCacheFor !== this.contractHosts.length) { this.chainCache = new Map(); this.chainCacheFor = this.contractHosts.length; }
    const cache = this.chainCache; let answer = cache.get(key);
    if (answer === undefined) cache.set(key, answer = this.contractHosts.some(host => host.supports(key)) || this.systemBarsHost.supports(key) || this.dialogWindowHost.supports(key) || this.viewOutlineHost.supports(key) || this.composeCanvasHost.supports(key) || this.viewTransformHost.supports(key) || this.viewPropertyAnimatorHost.supports(key) || this.viewCoordinateHost.supports(key) || this.editableTextHost.supports(key) || this.componentCallbacksHost.supports(key) || this.viewStateHost.supports(key) || this.localeService.supports(key) || this.viewWindowHost.supports(key) || this.canvasHost.supports(key) || this.paintHost.supports(key) || this.contentHost.supports(key) || this.drawableViewHost.supports(key) || this.deviceServices.supports(key) || this.insetsHost.supports(key) || this.accessibilityService.supports(key) || this.viewLayoutHost.supports(key) || this.inputMethodService.supports(key) || this.autofillService.supports(key) || this.clipboardService.supports(key) || this.viewInputHost.supports(key) || this.viewTreeHost.supports(key) || XML_METHODS.has(key) || STYLE_METHODS.has(key));
    return answer;
  }
  invoke(runtime, method, args) {
    const owner = method.owner, name = method.name, receiver = args[0];
    const key = `${owner}->${name}${method.signature}`;
    {   // the contract host that serves the key is remembered once found (about thirty hosts were asked on every bridged call); a miss is not remembered because hosts can define methods later
      const routes = this.contractRoutes ??= new Map(); let host = routes.get(key);
      if (host === undefined || !host.supports(key)) { host = this.contractHosts.find(candidate => candidate.supports(key)); if (host !== undefined) routes.set(key, host); else routes.delete(key); }
      if (host !== undefined) return host.invoke(runtime, method, args);
    }
    if (this.chainTouches(key)) {
      if (this.systemBarsHost.supports(`${owner}->${name}${method.signature}`)) { if (owner === WINDOW && runtime.object(receiver).webPhoneWindow) { if (name === 'getInsetsController') return this.systemBarsHost.windowController(runtime, receiver); return /^get/.test(name) ? (name.startsWith('is') ? 0 : 0) : undefined; } return this.systemBarsHost.invoke(runtime, method, args); }
      if (this.dialogWindowHost.supports(`${owner}->${name}${method.signature}`) && this.dialogWindowHost.handles(runtime,method,args)) return this.dialogWindowHost.invoke(runtime,method,args);
      if (this.viewOutlineHost.supports(`${owner}->${name}${method.signature}`)) return this.viewOutlineHost.invoke(runtime, method, args);
      if (this.composeCanvasHost.supports(`${owner}->${name}${method.signature}`)) return this.composeCanvasHost.invoke(runtime, method, args);
      if (this.viewTransformHost.supports(`${owner}->${name}${method.signature}`)) return this.viewTransformHost.invoke(runtime, method, args);
      if (this.viewPropertyAnimatorHost.supports(`${owner}->${name}${method.signature}`)) return this.viewPropertyAnimatorHost.invoke(runtime, method, args);
      if (this.viewCoordinateHost.supports(`${owner}->${name}${method.signature}`)) return this.viewCoordinateHost.invoke(runtime, method, args);
      if (this.editableTextHost.supports(`${owner}->${name}${method.signature}`)) return this.editableTextHost.invoke(runtime, method, args);
      if (this.componentCallbacksHost.supports(`${owner}->${name}${method.signature}`)) return this.componentCallbacksHost.invoke(runtime, method, args);
      if (this.viewStateHost.supports(`${owner}->${name}${method.signature}`)) return this.viewStateHost.invoke(runtime, method, args);
      if (this.localeService.supports(`${owner}->${name}${method.signature}`)) return this.localeService.invoke(runtime, method, args);
      if (this.viewWindowHost.supports(`${owner}->${name}${method.signature}`)) return this.viewWindowHost.invoke(runtime, method, args);
      if (this.canvasHost.supports(`${owner}->${name}${method.signature}`)) return this.canvasHost.invoke(runtime, method, args);
      if (this.paintHost.supports(`${owner}->${name}${method.signature}`)) return this.paintHost.invoke(runtime, method, args);
      if (this.contentHost.supports(`${owner}->${name}${method.signature}`)) return this.contentHost.invoke(runtime, method, args);
      if (this.drawableViewHost.supports(`${owner}->${name}${method.signature}`)) return this.drawableViewHost.invoke(runtime, method, args);
      if (this.deviceServices.supports(`${owner}->${name}${method.signature}`)) return this.deviceServices.invoke(runtime, method, args);
      if (this.insetsHost.supports(`${owner}->${name}${method.signature}`)) return this.insetsHost.invoke(runtime, method, args);
      if (this.accessibilityService.supports(`${owner}->${name}${method.signature}`)) return this.accessibilityService.invoke(runtime, method, args);
      if (this.viewLayoutHost.supports(`${owner}->${name}${method.signature}`)) return this.viewLayoutHost.invoke(runtime, method, args);
      if (this.inputMethodService.supports(`${owner}->${name}${method.signature}`)) return this.inputMethodService.invoke(runtime, method, args);
      if (this.autofillService.supports(`${owner}->${name}${method.signature}`)) return this.autofillService.invoke(runtime, method, args);
      if (this.clipboardService.supports(`${owner}->${name}${method.signature}`)) return this.clipboardService.invoke(runtime, method, args);
      if (this.viewInputHost.supports(`${owner}->${name}${method.signature}`)) return this.viewInputHost.invoke(runtime, method, args);
      if (XML_METHODS.has(`${owner}->${name}${method.signature}`)) return this.xmlHost.invoke(runtime, method, args);
      if (this.viewTreeHost.supports(`${owner}->${name}${method.signature}`)) return this.viewTreeHost.invoke(runtime, method, args);
      if (STYLE_METHODS.has(`${owner}->${name}${method.signature}`)) return this.styleBackend.invoke(runtime, method, args);
    }
    if (owner === 'Landroid/app/ActivityManager;') { const fields = runtime.object(args[0]).fields, running = !this.taskClosed; for (const [field, value] of Object.entries({ pid: this.virtualProcess.pid, uid: this.virtualProcess.uid, importance: running ? 100 : 400, lastTrimLevel: 0, lru: 0, importanceReasonCode: 0, processState: this.frames.some(frame => frame.lifecycleStage === 4) ? 2 : 6 })) runtime.storeField(fields, `${PROCESS_INFO}->${field}:I`, value); runtime.record('PROCESS virtual foreground state (logical IDs; no host telemetry)'); return; }
    if (owner === PROCESS_INFO) {
      const fields = runtime.object(receiver).fields;
      if (!method.parameters.length) { runtime.storeField(fields, `${PROCESS_INFO}->importance:I`, 100); runtime.storeField(fields, `${PROCESS_INFO}->importanceReasonCode:I`, 0); runtime.storeField(fields, `${PROCESS_INFO}->processState:I`, 6); }
      else { runtime.storeField(fields, `${PROCESS_INFO}->processName:Ljava/lang/String;`, args[1]); runtime.storeField(fields, `${PROCESS_INFO}->pid:I`, args[2]); runtime.storeField(fields, `${PROCESS_INFO}->pkgList:[Ljava/lang/String;`, args[3]); }
      return;
    }
    if (owner === LOCALE) {
      if (name === 'getDefault') { const override = this.defaultLocaleOverride; return this.locale(runtime, override && override.device === this.device.locale ? override.tag : this.device.locale); }   // Locale.setDefault holds until the device locale changes
      if (name === 'forLanguageTag') return this.locale(runtime, args[0]);
      const object = runtime.object(receiver);
      if (name === '<init>') { const language = String(args[1] || '').toLowerCase(), country = String(args[2] || '').toUpperCase(), variant = String(args[3] || ''); object.localeData = { language, country, variant, tag: [language || 'und', country, variant.replaceAll('_', '-')].filter(Boolean).join('-') }; return; }
      const data = object.localeData;
      if (!data) error('Locale used before initialization');
      if (name === 'clone') { const copy = runtime.makeObject(LOCALE); runtime.object(copy).localeData = { ...data }; return copy; }
      if (name === 'getScript') return data.script || '';
      if (name === 'getLanguage') return data.language; if (name === 'getCountry') return data.country; if (name === 'getVariant') return data.variant;
      if (name === 'toLanguageTag') return data.tag;
      if (name === 'equals') return args[1] && typeof args[1] === 'object' && Number.isInteger(args[1].ref) && runtime.object(args[1]).localeData?.tag === data.tag ? 1 : 0;
      return data.language + (data.country || data.variant ? '_' + data.country : '') + (data.variant ? '_' + data.variant : '');
    }
    if (owner === LOCALES) {
      if (name === 'getDefault' || name === 'getAdjustedDefault') return this.localeList(runtime, [this.locale(runtime, this.device.locale)]);
      if (name === 'getEmptyLocaleList') return this.localeList(runtime, []);
      if (name === 'forLanguageTags') return this.localeList(runtime, String(args[0] || '').split(',').map(tag => tag.trim()).filter(Boolean).map(tag => this.locale(runtime, tag)));
      const object = runtime.object(receiver);
      if (name === '<init>') { object.locales = runtime.array(args[1]).elements.filter((locale, index, values) => values.findIndex(other => runtime.object(other).localeData?.tag === runtime.object(locale).localeData?.tag) === index); return; }
      const locales = object.locales || [];
      if (name === 'getFirstMatch') {   // LocaleList.computeFirstMatch (android-13.0.0_r1): the first desired locale matching a supported one by language and likely script; no match falls back to the first
        if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', null);
        if (locales.length === 0) return null; if (locales.length === 1) return locales[0];
        const dataOf = locale => runtime.object(locale).localeData, tagOf = locale => dataOf(locale).tag;
        const likelyScript = locale => { const data = dataOf(locale); if (data.script) return data.script; try { return new Intl.Locale(data.tag).maximize().script ?? ''; } catch { return ''; } };
        const pseudo = locale => { const data = dataOf(locale); return (data.language === 'en' && data.country === 'XA') || (data.language === 'ar' && data.country === 'XB'); };
        const matches = (supported, desired) => {
          if (tagOf(supported) === tagOf(desired)) return true;
          if (dataOf(supported).language !== dataOf(desired).language) return false;
          if (pseudo(supported) || pseudo(desired)) return false;
          const supportedScript = likelyScript(supported);
          if (supportedScript === '') { const region = dataOf(supported).country; return region === '' || region === dataOf(desired).country; }
          return supportedScript === likelyScript(desired);
        };
        let best = Infinity;
        for (const tag of runtime.array(args[1]).elements) {
          const supported = this.locale(runtime, runtime.stringCharacters(tag)); let index = locales.findIndex(desired => matches(supported, desired)); if (index < 0) index = Infinity;
          if (index === 0) return locales[0]; if (index < best) best = index;
        }
        return best === Infinity ? locales[0] : locales[best];
      }
      if (name === 'get') return locales[args[1]] ?? null;
      if (name === 'size') return locales.length; if (name === 'isEmpty') return locales.length ? 0 : 1;
      if (name === 'indexOf') return locales.findIndex(locale => runtime.object(locale).localeData.tag === runtime.object(args[1]).localeData.tag);
      return locales.map(locale => runtime.object(locale).localeData.tag).join(',');
    }
    if (owner === PACKAGE_MANAGER) {
      if (name === 'hasSystemFeature') { if (args[1] === null || args[1] === 0) runtime.throwJava('Ljava/lang/NullPointerException;', null); return this.systemFeatures.has(runtime.stringCharacters(args[1])) && (args.length < 3 || args[2] <= 0) ? 1 : 0; }   // only DEVICE_FEATURES (src/service-kit.js), at version 0
      if (name === 'getApplicationInfo') { if (args[1] !== this.packageName) error(`PackageManager has no external package ${args[1]}`); return this.applicationInfo(runtime, (Number(args[2]) & 128) !== 0); }
      const component = runtime.object(args[1]); if (component.packageName !== this.packageName) error('PackageManager can only query this APK');
      if(name==='getServiceInfo'){if(!this.manifest?.services?.includes(component.className))runtime.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;',component.className);error('ServiceInfo metadata transport is not installed for declared service '+component.className,{kind:'service-info-unsupported'});}
      const declaration = this.manifest?.activities?.find(activity => activity.name === component.className);
      if (!declaration) error(`Activity missing from actual manifest: ${component.className}`);
      const info = runtime.makeObject(ACTIVITY_INFO); const put = (name, type, value) => this.infoField(runtime, info, ACTIVITY_INFO, name, type, value);
      put('name', 'Ljava/lang/String;', declaration.name); put('packageName', 'Ljava/lang/String;', this.packageName); put('applicationInfo', APPLICATION_INFO, this.applicationInfo(runtime));
      put('configChanges', 'I', Number(declaration.configChanges || 0)); put('screenOrientation', 'I', Number.isFinite(Number(declaration.screenOrientation)) ? Number(declaration.screenOrientation) | 0 : -1); put('theme', 'I', Number(declaration.theme || this.manifest.application?.theme || 0)); put('exported', 'Z', declaration.exported === true || declaration.exported === 'true' ? 1 : 0); put('parentActivityName', 'Ljava/lang/String;', declaration.parentActivityName || null); put('permission', 'Ljava/lang/String;', declaration.permission || null);
      // ActivityInfo as PackageParser fills it (ComponentInfo.enabled defaults to true, processName to the application's process, taskAffinity to the application's); GET_META_DATA (128) decides whether metaData is filled.
      const number = value => Number.isFinite(Number(value)) ? Number(value) | 0 : 0, isFalse = value => value === false || value === 'false' || value === 0, isTrue = value => value === true || value === 'true' || (Number.isInteger(value) && value !== 0), appInfo = this.applicationInfo(runtime);
      const fieldOf = (owner, name, type) => runtime.object(appInfo).fields.get(runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }).key);
      put('exported', 'Z', isTrue(declaration.exported) ? 1 : 0); put('enabled', 'Z', isFalse(declaration.enabled) ? 0 : 1); put('directBootAware', 'Z', isTrue(declaration.directBootAware) ? 1 : 0);
      put('processName', 'Ljava/lang/String;', declaration.process ? (String(declaration.process).startsWith(':') ? this.packageName + declaration.process : declaration.process) : fieldOf(APPLICATION_INFO, 'processName', 'Ljava/lang/String;') ?? this.packageName);
      put('taskAffinity', 'Ljava/lang/String;', declaration.taskAffinity ?? fieldOf(APPLICATION_INFO, 'taskAffinity', 'Ljava/lang/String;') ?? this.packageName);
      put('labelRes', 'I', typeof declaration.label === 'number' ? declaration.label : 0); put('nonLocalizedLabel', 'Ljava/lang/CharSequence;', typeof declaration.label === 'string' ? declaration.label : null); put('icon', 'I', typeof declaration.icon === 'number' ? declaration.icon : 0);
      for (const attribute of ['launchMode', 'documentLaunchMode', 'softInputMode', 'uiOptions', 'colorMode', 'persistableMode', 'lockTaskLaunchMode', 'maxRecents']) if (declaration[attribute] !== undefined) put(attribute, 'I', number(declaration[attribute]));
      put('metaData', BUNDLE, (Number(args[2]) & 128) !== 0 ? this.appServices.metaDataBundle(runtime, declaration.metaData ?? []) : null); return info;
    }
    if (owner === COMPONENT) {
      const object = runtime.object(receiver);
      if (name === '<init>') { object.packageName = typeof args[1] === 'string' ? args[1] : this.packageName; object.className = method.parameters[1] === 'Ljava/lang/Class;' ? runtime.object(args[2]).classType.slice(1, -1).replaceAll('/', '.') : args[2]; return; }
      if (name === 'getClassName') return object.className; if (name === 'getPackageName') return object.packageName;
      return `${object.packageName}/${name === 'flattenToShortString' && object.className.startsWith(object.packageName + '.') ? object.className.slice(object.packageName.length) : object.className}`;
    }
    if (owner === CONFIGURATION) {
      const fields = runtime.object(receiver).fields;
      if (name === 'getLayoutDirection') return (fields.get(`${CONFIGURATION}->screenLayout:I`) & 0xc0) === 0x80 ? 1 : 0;
      if (name === 'getLocales') return fields.get(`${CONFIGURATION}->mLocaleList:${LOCALES}`) || this.localeList(runtime, [this.locale(runtime, 'en-US')]);
      if (name === 'setLocales' || name === 'setLocale') { const list = name === 'setLocale' ? this.localeList(runtime, [args[1]]) : args[1]; runtime.storeField(fields, `${CONFIGURATION}->mLocaleList:${LOCALES}`, list); runtime.storeField(fields, `${CONFIGURATION}->locale:${LOCALE}`, runtime.object(list).locales?.[0] || null); return; }
      if (args[1]) for (const [key, value] of runtime.object(args[1]).fields) runtime.storeField(runtime.object(receiver).fields, key, value); else this.initializeConfiguration(runtime, receiver); return; }
    if (owner === ATTRIBUTES) {
      const attrs = runtime.object(receiver).node.attributes;
      if (name === 'getAttributeCount') return attrs.length;
      if (name === 'getStyleAttribute') return attrs.find(attr => attr.name === 'style')?.reference || 0;
      if (name === 'getPositionDescription') return `Binary XML line ${runtime.object(receiver).node.lineNumber}`;
      const attr = typeof args[1] === 'number' ? attrs[args[1]] : attrs.find(attr => attr.namespace === args[1] && attr.name === args[2]);
      if (name === 'getAttributeName') return attr?.name ?? null;
      if (name === 'getAttributeNameResource') return attr?.resourceId || 0;
      if (name === 'getAttributeValue') return attr ? attr.rawValue ?? (attr.kind === 'reference' ? `@${attr.reference}` : String(attr.value)) : null;
      const fallback = args.at(-1); if (!attr) return fallback;
      if (name === 'getAttributeResourceValue') return attr.reference ?? fallback;
      if (name === 'getAttributeBooleanValue') return attr.kind === 'boolean' ? attr.value ? 1 : 0 : fallback;
      return ['integer', 'boolean'].includes(attr.kind) ? Number(attr.value) : fallback;
    }
    if (owner === INFLATER) {
      if (name === 'from') return this.inflater(runtime, args[0]);
      const object = runtime.object(receiver);
      if (name === 'getContext') return object.context;
      if (name === 'getFactory' || name === 'getFactory2') return object.factory ?? null;
      if (name === 'setFactory' || name === 'setFactory2') { if (object.factory && !sameRef(object.factory, args[1])) error('LayoutInflater factory is already set'); object.factory = args[1]; object.factory2 = name === 'setFactory2'; return; }
      if (name === 'cloneInContext') { const clone = runtime.makeObject(INFLATER); Object.assign(runtime.object(clone), { context: args[1], factory: object.factory, factory2: object.factory2 }); return clone; }
      const root = args[2], attach = method.parameters.length === 2 ? !nullish(root) : !!args[3];
      const view = this.inflate(runtime, this.resources?.getLayout(args[1]) ?? error('XML resources unavailable'), object.context);
      if (attach && !nullish(root)) { runtime.object(root).children.push(view); runtime.object(view).parent = root; return root; } return view;
    }
    if (owner === WINDOW) {
      const object = runtime.object(receiver), frame = this.frame(runtime, object.host);
      if (name === 'getDecorView') { object.decorRequested = true; return object.decor; }
      if (name === 'peekDecorView') return object.decorRequested ? object.decor : null;
      if (name === 'getCallback') return object.callback;
      if (name === 'setCallback') { object.callback = args[1]; return; }
      if (name === 'findViewById') return this.find(runtime, object.decor, args[1]);
      if (name === 'requestFeature') { object.features.add(args[1]); return 1; }
      if (name === 'hasFeature') return object.features.has(args[1]) ? 1 : 0;
      return this.invoke(runtime, { ...method, owner: ACTIVITY }, [frame.activity, args[1]]);
    }
    if (PARAM_TYPES.includes(owner)) {
      const object = runtime.object(receiver), fields = object.fields;
      if (name === '<init>') { if (method.parameters[0] === 'Landroid/content/Context;') { this.layoutParamsFromAttributes(runtime, null, args[2], receiver, args[1], owner); return; } if (method.parameters[0] === 'I') { runtime.storeField(fields, `${LAYOUT_PARAMS}->width:I`, args[1]); runtime.storeField(fields, `${LAYOUT_PARAMS}->height:I`, args[2]); if (method.parameters.length === 3) runtime.storeField(fields, 'Landroid/widget/LinearLayout$LayoutParams;->weight:F', args[3]); } else for (const [key, value] of runtime.object(args[1]).fields) runtime.storeField(fields, key, value); return; }
      for (const [index, edge] of ['left', 'top', 'right', 'bottom'].entries()) runtime.storeField(fields, `${MARGIN_PARAMS}->${edge}Margin:I`, args[index + 1]); return;
    }
    if (owner === EDITABLE) { const text = runtime.object(runtime.object(receiver).sourceView).text; if (name === 'toString') return text; if (name === 'length') return text.length; if (name === 'charAt') { if (args[1] < 0 || args[1] >= text.length) error('Editable charAt index out of bounds'); return text.charCodeAt(args[1]); } return text.slice(args[1], args[2]); }
    if ([FRAGMENT, FRAGMENT_MANAGER, TRANSACTION].includes(owner)) return this.fragmentInvoke(runtime, method, args);
    if (owner === KEY_SET || owner === KEY_ITERATOR) return this.keyViewInvoke(runtime, method, args);
    if (owner === INTENT) return this.intentInvoke(runtime, method, args);
    if (owner === BUNDLE || owner === 'Landroid/os/BaseBundle;' || owner === 'Landroid/os/PersistableBundle;') return this.bundleInvoke(runtime, method, args);
    if (CONTEXTS.includes(owner)) {
      if(name==='createConfigurationContext')return this.createConfigurationContext(runtime,receiver,args[1]);
      if (name === 'isRestricted') { let ref = receiver; const seen = new Set(); while (ref) { if (seen.has(ref.ref) || seen.size > 64) error('Cyclic ContextWrapper chain'); seen.add(ref.ref); const context = runtime.object(ref); if (context.contextFlags !== undefined) return context.contextFlags & 4 ? 1 : 0; ref = context.baseContext; } return 0; }
      if (name === 'getClassLoader') return runtime.applicationClassLoader ??= this.classLoaders.createApplicationLoader(runtime);
      if (name === 'getSystemServiceName') { if (args[1] === null || args[1] === 0) runtime.throwJava('Ljava/lang/NullPointerException;', null); return this.serviceNameForClass(runtime.object(args[1]).classType); }
      if (name === 'getSystemService') { let serviceName = args[1]; if (method.parameters[0] === 'Ljava/lang/Class;') { const type = runtime.object(args[1]).classType; serviceName = this.serviceNameForClass(type); if (!serviceName) { if (absentModuleService(type)) { runtime.record(`SERVICE ${type} -> null: its mainline module is not installed in the virtual device`); return null; } error(`System service class ${type} is not installed in the virtual device`); } } if (serviceName === 'layout_inflater') return this.inflater(runtime, receiver); const service = this.dialogWindowHost.getService(runtime,receiver,serviceName) || this.accessibilityService.getService(runtime, serviceName) || this.autofillService.getService(runtime, serviceName) || this.clipboardService.getService(runtime, serviceName) || this.inputMethodService.getService(runtime, serviceName) || this.deviceState.getService(runtime, serviceName) || this.jobScheduler.getService(runtime, serviceName) || this.javaServices.getService(runtime, serviceName) || this.appServices.getService(runtime, serviceName) || this.hardwareServices.getService(runtime, serviceName) || this.peripheralServices.getService(runtime, serviceName) || this.storageServices.getService(runtime, serviceName) || this.systemManagers.getService(runtime, serviceName); if (service) return service; if (this.nullServices.includes(serviceName)) return null; error(`System service ${serviceName} is not installed in the virtual device`); }
      if (owner === APPLICATION && name === 'registerActivityLifecycleCallbacks') { this.applicationCallbacks.push(args[1]); return; }
      if (name === 'registerActivityLifecycleCallbacks' && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY)) { if (nullish(args[1])) error('Activity lifecycle callback is null'); (runtime.object(receiver).activityCallbacks ??= []).push(args[1]); return; }
      if (name === 'unregisterActivityLifecycleCallbacks' && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY)) { const list = runtime.object(receiver).activityCallbacks ?? [], index = list.findIndex(ref => sameRef(ref, args[1])); if (index >= 0) list.splice(index, 1); return; }
      if (owner === APPLICATION && name === 'unregisterActivityLifecycleCallbacks') { const index = this.applicationCallbacks.findIndex(ref => sameRef(ref, args[1])); if (index >= 0) this.applicationCallbacks.splice(index, 1); return; }
      if (owner === APPLICATION && (name === '<init>' || name === 'onCreate')) return; // Defined empty framework lifecycle bodies.
      if (name === 'getPackageManager') return this.packageManager ??= runtime.makeObject(PACKAGE_MANAGER);
      if (name === 'getApplicationInfo') return this.applicationInfo(runtime);
      if (name === 'getApplication' || name === 'getApplicationContext') { if (!this.application) error('Application lifecycle has not initialized'); return this.application; }
      if (name === 'getPackageName') { const packageName = this.packageName || this.resources?.table?.packages?.[0]?.name; if (!packageName) error('Manifest package name unavailable'); return packageName; }
      if (name === 'attachBaseContext' || name === '<init>' && owner === 'Landroid/content/ContextWrapper;') { runtime.object(receiver).baseContext = args[1]; return; }
      if (name === 'getWindowManager' && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY)) return runtime.dispatch({ owner: 'Landroid/content/Context;', name: 'getSystemService', parameters: ['Ljava/lang/String;'], result: 'Ljava/lang/Object;', signature: '(Ljava/lang/String;)Ljava/lang/Object;' }, [receiver, 'window'], 'virtual');   // Activity.getWindowManager: the window's WindowManager (the 'window' service)
      if (name === 'getOnBackInvokedDispatcher' && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY)) return this.backDispatcher.forOwner(runtime, receiver);
      if (name === 'getBaseContext') return runtime.object(receiver).baseContext ?? null;
      if (name === '<init>') { this.frame(runtime, receiver); const base='Landroid/view/ContextThemeWrapper;';if(owner===ACTIVITY&&runtime.dex.bootClasses?.has(base))runtime.dispatch({owner:base,name:'<init>',parameters:[],result:'V',signature:'()V'},[receiver],'direct'); return; }
      if (name === 'onCreate') { const frame = this.frame(runtime, receiver); frame.lifecycleStage = 1; this.strictModeActivity(runtime, receiver, 'created'); this.moveFragments(runtime, frame, 1); this.notifyActivity(runtime, frame, 'Created', args[1]); return; }
      if (name === 'getResources') return this.resourcesForContext(runtime,receiver);
      if (name === 'getString' || name === 'getText') return this.resource(args[1], ['string']).value;
      if (name === 'startActivity') return this.startActivity(runtime, args[1], null, -1, { fromActivity: this.isActivityContext(runtime, receiver) });
      if (name === 'startActivityForResult') { if (args[3] && this.extras(runtime, args[3]).size) error('Non-empty Activity launch options require their original transition/window boundary'); return this.startActivity(runtime, args[1], receiver, args[2]); }
      if (name === 'setResult') { if (args[2] && !runtime.isSubtype(runtime.object(args[2]).type, INTENT)) error('Activity result data must be an Intent'); const object = runtime.object(receiver); object.activityResultCode = args[1]; object.activityResultData = args[2] || null; return; }
      if (name === 'onActivityResult') return; // Empty Activity base callback; APK/AndroidX overrides have DEX priority.
      if (name === 'isFinishing') { const target = this.allFrames().find(frame => sameRef(frame.activity, receiver)); return this.finishedActivities.has(receiver.ref) || target?.finishRequested || target?.finishing || target?.finishQueued ? 1 : 0; }
      if (name === 'isDestroyed') return this.finishedActivities.has(receiver.ref) || this.allFrames().find(frame => sameRef(frame.activity, receiver))?.destroyed ? 1 : 0;
      const frame = this.frame(runtime, receiver);
      if (name === 'getComponentName') { const component = runtime.makeObject(COMPONENT); Object.assign(runtime.object(component), { packageName: this.packageName, className: frame.type.slice(1, -1).replaceAll('/', '.') }); return component; }
      if (name === 'getLocalClassName') { const className = frame.type.slice(1, -1).replaceAll('/', '.'), prefix = this.packageName + '.'; return className.startsWith(prefix) ? className.slice(prefix.length) : className; }
      if (name === 'getLayoutInflater') return this.inflater(runtime, receiver);
      if (name === 'onCreateView') { if (method.parameters.length === 3) return null; if (args[2] === 'fragment') error('Native framework <fragment> inflation requires its Fragment inflater boundary'); return runtime.dispatch({ owner: ACTIVITY, name: 'onCreateView', signature: '(Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', parameters: ['Ljava/lang/String;', 'Landroid/content/Context;', 'Landroid/util/AttributeSet;'], result: 'Landroid/view/View;' }, [receiver, args[2], args[3], args[4]], 'virtual'); }
      if (name === 'getTitle') { const object = runtime.object(receiver); if (object.title !== undefined) return object.title; const declaration = this.manifest?.activities?.find(activity => activity.name === frame.type.slice(1, -1).replaceAll('/', '.')); const label = declaration?.label ?? this.manifest?.application?.label ?? declaration?.name ?? this.packageName; return object.title = typeof label === 'number' ? this.resource(label, ['string']).value : label; }
      if (name === 'setTitle') { runtime.object(receiver).title = method.parameters[0] === 'I' ? this.resource(args[1], ['string']).value : args[1]; if (runtime.objectOverride?.(runtime.object(receiver).type, 'onTitleChanged(Ljava/lang/CharSequence;I)V')) runtime.dispatch({ owner: ACTIVITY, name: 'onTitleChanged', signature: '(Ljava/lang/CharSequence;I)V', parameters: ['Ljava/lang/CharSequence;', 'I'], result: 'V' }, [receiver, runtime.object(receiver).title, runtime.object(receiver).titleColor ?? 0], 'virtual'); return; }
      if (name === 'getWindow') return this.window(runtime, frame);
      if (name === 'getFragmentManager') return this.fragmentManager(runtime, frame);
      if (name === 'getLastNonConfigurationInstance') return frame.retained ?? null;
      if (name === 'onRetainNonConfigurationInstance') return null;
      if (name === 'isChangingConfigurations') return frame.changingConfiguration ? 1 : 0;
      if (name === 'recreate') { if (!frame.recreationPending) { frame.recreationPending = true; this.queueTask(() => this.recreateActivity(runtime, frame), 0, [frame.activity]); } return; }
      const stages = { onStart: 3, onResume: 4, onPause: 3, onStop: 2, onDestroy: 0 };
      if (Object.hasOwn(stages, name)) { frame.lifecycleStage = stages[name]; this.notifyActivity(runtime, frame, { onStart: 'Started', onResume: 'Resumed', onPause: 'Paused', onStop: 'Stopped', onDestroy: 'Destroyed' }[name]); return; }
      if (name === 'onSaveInstanceState') { runtime.object(args[1]).frameworkViewState = this.captureViewState(runtime, frame.root); this.notifyActivity(runtime, frame, 'SaveInstanceState', args[1]); return; }
      if (name === 'onRestoreInstanceState') { this.restoreViewState(runtime, frame.root, runtime.object(args[1]).frameworkViewState); return; }
      if (name === 'onPostCreate' || name === 'onPostResume' || name === 'onRestart' || name === 'onConfigurationChanged') return; // Activity.onConfigurationChanged has no state of its own here (fragments/Window are driven by the DEX overrides and deviceState)
      if (name === 'setContentView') {
        const root = method.parameters[0] === 'I' ? (runtime.classes.has('Lcom/android/internal/policy/PhoneLayoutInflater;') ? runtime.dispatch({ owner: INFLATER, name: 'inflate', signature: '(ILandroid/view/ViewGroup;Z)Landroid/view/View;', parameters: ['I', 'Landroid/view/ViewGroup;', 'Z'], result: 'Landroid/view/View;' }, [this.inflater(runtime, receiver), args[1], null, 0], 'virtual') : this.inflate(runtime, this.resources?.getLayout(args[1]) ?? error('XML layout resources unavailable'), receiver)) : args[1];
        if (args[2]) this.invoke(runtime, { owner: 'Landroid/view/View;', name: 'setLayoutParams' }, [root, args[2]]);
        if (!runtime.isSubtype(runtime.object(root).type, 'Landroid/view/View;')) error('setContentView requires a View');
        if (frame.root && !sameRef(frame.root, root)) this.attachTree(runtime, frame.root, false); frame.root = root; if (frame.window) { const content = runtime.object(frame.window).content; runtime.object(content).children = [root]; runtime.object(root).parent = content; } if (sameRef(runtime.activity, receiver)) runtime.root = root; this.viewLayoutHost.rootReady(runtime, root); if (frame.lifecycleStage === 4) this.attachTree(runtime, root, true); return;
      }
      if (name === 'findViewById') return this.find(runtime, frame.root, args[1]) || (frame.window ? this.find(runtime, runtime.object(frame.window).decor, args[1]) : null);
      if (name === 'getIntent') return this.initialIntent(runtime, frame);
      if (name === 'setIntent') { if (runtime.object(args[1]).type !== INTENT) error('setIntent requires Intent'); frame.intent = args[1]; return; }
      if (name === 'finish') return this.finish(runtime, receiver);
      if (name === 'isFinishing') return frame.finished ? 1 : 0;
      if (name === 'onBackPressed') return this.finish(runtime, receiver);
    }
    const object = runtime.object(receiver);
    if (name === 'requestDisallowInterceptTouchEvent') {   // ViewGroup: set/clear FLAG_DISALLOW_INTERCEPT, then ask the parent the same
      const want = !!args[1]; if (!!object.disallowIntercept === want) return; object.disallowIntercept = want;
      if (object.parent) runtime.dispatch({ owner: 'Landroid/view/ViewParent;', name, parameters: ['Z'], result: 'V', signature: '(Z)V' }, [object.parent, want ? 1 : 0], 'virtual');
      return;
    }
    if (name === 'onDescendantInvalidated') {
      runtime.object(args[1]); runtime.object(args[2]); object.drawingCacheValid = false;
      this.requestDraw(runtime, receiver);
      if (object.parent) runtime.dispatch({owner:'Landroid/view/ViewParent;',name,parameters:['Landroid/view/View;','Landroid/view/View;'],result:'V',signature:'(Landroid/view/View;Landroid/view/View;)V'},[object.parent,receiver,object.layerType===1?receiver:args[2]],'virtual');
      return;
    }
    if (name === 'setSaveFromParentEnabled') { object.saveFromParentEnabled = !!args[1]; return; } if (name === 'isSaveFromParentEnabled') return object.saveFromParentEnabled === false ? 0 : 1;
    if (name === 'setSaveEnabled') { object.saveEnabled = !!args[1]; return; } if (name === 'isSaveEnabled') return object.saveEnabled === false ? 0 : 1;
    if (name === 'onViewAdded' || name === 'onViewRemoved') return; // Original ViewGroup base callback bodies are empty.
    if (name === 'saveAttributeDataForStyleable') { if (this.debugViewAttributes) error('Attribute-resolution debug stacks are not installed'); return; } // AOSP View: returns immediately when sDebugViewAttributes is disabled, as in this VM profile.
    if (name === 'isForegroundInsidePadding') return object.foregroundInsidePadding === false ? 0 : 1;
    if (name === 'getForegroundGravity') return object.foregroundGravity ?? 119;
    if (name === 'setForegroundGravity') { let gravity = args[1]; if (!(gravity & 0x800007)) gravity |= 0x800003; if (!(gravity & 0x70)) gravity |= 0x30; object.foregroundGravity = gravity; this.requestDraw(runtime, receiver); return; }
    if (name === 'hasOnClickListeners') return object.listener ? 1 : 0;
    if (name === 'isLaidOut') return object.laidOut ? 1 : 0;
    if (name === 'generateDefaultLayoutParams') { const linear = runtime.isSubtype(object.type, 'Landroid/widget/LinearLayout;'), frame = runtime.isSubtype(object.type, 'Landroid/widget/FrameLayout;'), type = linear ? 'Landroid/widget/LinearLayout$LayoutParams;' : frame ? 'Landroid/widget/FrameLayout$LayoutParams;' : LAYOUT_PARAMS, width = linear ? object.orientation === 1 ? -1 : -2 : frame ? -1 : -2, height = frame ? -1 : -2, ref = runtime.allocate(type); runtime.dispatch({ owner: type, name: '<init>', signature: '(II)V', parameters: ['I', 'I'], result: 'V' }, [ref, width, height], 'direct'); return ref; }
    if (name === 'generateLayoutParams') return this.layoutParamsFromAttributes(runtime, receiver, args[1]);
    if (name === 'onFinishInflate') return; // AOSP View.onFinishInflate() has an empty base body.
    if (name === '<init>' && method.parameters[0] === 'Landroid/content/Context;') { object.context = args[1]; object.enabled = true; if(method.parameters[2]==='I')object.defStyleAttr=args[3]; if (runtime.isSubtype(object.type, 'Landroid/widget/TextView;')) object.textSize = Math.fround((runtime.isSubtype(object.type, 'Landroid/widget/EditText;') ? 18 : 14) * (this.device.fontScale || 1)); /* these defaults are sp values (scaledDensity = density * fontScale) */ this.drawableViewHost.applyThemeDefaults(runtime, receiver, args[2]); this.drawableViewHost.applyStyledTextSize(runtime, receiver, args[2]); if (args[2] && runtime.object(args[2]).node) this.inflate(runtime, runtime.object(args[2]).node, args[1], 0, { existing: receiver, applyOnly: true }); this.syncViewFields(runtime, receiver); return; }
    if (owner === 'Landroid/content/res/Resources;') {
      if (name === 'getConfiguration') return this.resourceConfiguration(runtime,receiver);
      if(runtime.object(receiver).resourceConfigurationDifference)error('Resource selection for this changed configuration is not installed',{kind:'configuration-resources-unsupported',changes:runtime.object(receiver).resourceConfigurationDifference});
      if (name === 'getDisplayMetrics') return this.metrics(runtime);
      if (name === 'updateConfiguration') {
        // Resources.updateConfiguration(config, metrics): the framework swaps the resources' configuration and re-selects every qualified resource. Resource selection here follows the virtual
        // device (Dispositivo panel); a configuration that differs from it (a new locale, font scale, night mode...) would need a second selection pass, so it fails explicitly. The common
        // "re-apply the current configuration" call is accepted and re-resolves live Themes.
        const incoming = args[1], metricsArg = args[2];
        if (incoming !== null && incoming !== 0 && incoming !== undefined) {
          const current = this.resourceConfiguration(runtime, null), changes = runtime.dispatch({ owner: CONFIGURATION, name: 'diff', parameters: [CONFIGURATION], result: 'I', signature: `(${CONFIGURATION})I` }, [current, incoming], 'virtual');
          if (changes !== 0) error('Resources.updateConfiguration with a configuration that differs from the virtual device is not installed (resource selection follows the device)', { kind: 'configuration-resources-unsupported', changes });
        }
        if (metricsArg !== null && metricsArg !== 0 && metricsArg !== undefined && metricsArg.ref !== this.metrics(runtime).ref) {
          const mine = runtime.object(this.metrics(runtime)).fields, theirs = runtime.object(metricsArg).fields;
          for (const field of ['widthPixels', 'heightPixels', 'densityDpi']) if (mine.get(`${METRICS}->${field}:I`) !== theirs.get(`${METRICS}->${field}:I`)) error('Resources.updateConfiguration with DisplayMetrics that differ from the virtual device is not installed', { kind: 'configuration-resources-unsupported', field });
        }
        this.styleBackend.refreshThemes(runtime); return;
      }
      if (name === 'getIdentifier') { runtime.lastResourceCall = `Resources.getIdentifier(${[args[1], args[2], args[3]].map(v => (typeof v === 'string' ? v : v == null ? 'null' : (() => { try { return runtime.stringCharacters(v); } catch { return '?'; } })())).join(', ')})`;
        if (typeof args[1] !== 'string' || args[1].length > 4096) error('Resource name must be a bounded string');
        if (/^[0-9]+$/.test(args[1])) { const id = Number(args[1]); if (id > 0 && id <= 0x7fffffff) return id; }
        const full = /^(?:([^:]+):)?(?:([^/]+)\/)?([^/]+)$/.exec(args[1]); if (!full) return 0;
        const pkg = full[1] || args[3], type = full[2] || args[2]; if (!pkg || !type) return 0;
        const table = pkg === 'android' ? this.resources.frameworkTable : this.resources.table;
        return table?.findId(`${pkg}:${type}/${full[3]}`) || 0;
      }
      if (['getResourceName', 'getResourcePackageName', 'getResourceEntryName', 'getResourceTypeName'].includes(name)) {
        runtime.lastResourceCall = `Resources.${name}(0x${(args[1] >>> 0).toString(16)})`;
        const id = args[1] >>> 0, table = (id >>> 24) === 1 ? this.resources.frameworkTable : this.resources.table;
        const identity = table?.entries.get(id)?.[0]; if (!identity) runtime.throwJava('Landroid/content/res/Resources$NotFoundException;', `Unable to find resource ID #0x${id.toString(16)}`);   // ResourcesImpl.getResourceName/PackageName/TypeName/EntryName
        return identity[{ getResourceName: 'fullName', getResourcePackageName: 'packageName', getResourceEntryName: 'name', getResourceTypeName: 'resourceType' }[name]];
      }
      if (name === 'getStringArray' || name === 'getTextArray' || name === 'getIntArray') {   // Resources.getStringArray / getTextArray / getIntArray over a <string-array> / <integer-array> bag
        const bag = this.resources ? this.resources.resolve(args[1]) : { kind: 'unresolved' };
        if (bag.kind !== 'bag') runtime.throwJava('Landroid/content/res/Resources$NotFoundException;', `Resource ID #0x${(args[1] >>> 0).toString(16)} type #0x${bag.dataType?.toString(16) ?? '0'} is not valid`);
        const items = bag.items.map(item => { return item.dataType === 1 ? this.resource(item.rawData) : item; });
        if (name === 'getIntArray') { const array = runtime.newArray('[I', items.length); runtime.array(array).elements = items.map(item => item.rawData | 0); return array; }
        const text = item => (item.kind === 'string' ? item.value : item.dataType === 0x12 ? ((item.rawData | 0) !== 0 ? 'true' : 'false') : item.dataType >= 0x10 && item.dataType <= 0x1f ? String(item.rawData | 0) : null);
        const array = runtime.newArray(name === 'getTextArray' ? '[Ljava/lang/CharSequence;' : '[Ljava/lang/String;', items.length); runtime.array(array).elements = items.map(text); return array;
      }
      const resource = this.resource(args[1]);
      const kinds = { getString: 'string', getText: 'string', getInteger: 'integer', getBoolean: 'boolean', getColor: 'color', getDimension: 'dimension', getDimensionPixelSize: 'dimension', getDimensionPixelOffset: 'dimension' };
      if (resource.kind !== kinds[name]) error(`Resources.${name} received ${resource.kind}`);
      if (name === 'getBoolean') return resource.value ? 1 : 0;
      if (name === 'getColor') return resource.rawData | 0;
      if ((runtime.classes || runtime.dex.classes).has('Landroid/util/TypedValue;') && name.startsWith('getDimension')) return this.aospDimension(runtime, resource, { getDimension: 'complexToDimension', getDimensionPixelSize: 'complexToDimensionPixelSize', getDimensionPixelOffset: 'complexToDimensionPixelOffset' }[name]);
      if (name === 'getDimension') return floatBits(resource.value);
      if (name === 'getDimensionPixelSize') return Math.round(resource.value);
      if (name === 'getDimensionPixelOffset') return Math.trunc(resource.value);
      return resource.value;
    }
    if (['Landroid/view/ViewGroup;', 'Landroid/widget/LinearLayout;', 'Landroid/widget/FrameLayout;', 'Landroid/widget/ScrollView;'].includes(owner) && ['getChildCount', 'getChildAt', 'indexOfChild', 'removeViewAt', 'removeViews', 'removeAllViews', 'removeAllViewsInLayout', 'removeView', 'removeViewInLayout', 'detachViewFromParent', 'detachViewsFromParent', 'detachAllViewsFromParent', 'attachViewToParent', 'removeDetachedView', 'addView', 'addViewInLayout', 'setClipChildren', 'getClipChildren', 'setClipToPadding', 'getClipToPadding'].includes(name)) {
      if (name === 'setClipChildren') { object.clipChildren = !!args[1]; this.requestDraw(runtime, receiver); return; } if (name === 'getClipChildren') return object.clipChildren === false ? 0 : 1; if (name === 'setClipToPadding') { object.clipToPadding = !!args[1]; this.requestDraw(runtime, receiver); return; } if (name === 'getClipToPadding') return object.clipToPadding === false ? 0 : 1;
      if (name === 'getChildCount') return object.children.length;
      if (name === 'getChildAt') return object.children[args[1]] ?? null;
      if (name === 'removeViewAt' || name === 'removeViews') { // AOSP ViewGroup.removeViewAt/removeViews: range-check, then the same removal as removeView per child
        const start = args[1], count = name === 'removeViews' ? args[2] : 1;
        if (start < 0 || count < 0 || start + count > object.children.length) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child range');
        for (const child of object.children.slice(start, start + count)) this.invoke(runtime, { owner: 'Landroid/view/ViewGroup;', name: 'removeView' }, [receiver, child]); return;
      }
      if (name === 'indexOfChild') return object.children.findIndex(child => sameRef(child, args[1])); // AOSP ViewGroup.indexOfChild: identity index, -1 when absent
      if (name === 'removeAllViews') { for (const child of [...object.children]) this.invoke(runtime, { owner: 'Landroid/view/ViewGroup;', name: 'removeView' }, [receiver, child]); return; }
      if (name === 'removeAllViewsInLayout') { for (const child of [...object.children].reverse()) this.invoke(runtime, { owner: 'Landroid/view/ViewGroup;', name: 'removeViewInLayout' }, [receiver, child]); return; }   // ViewGroup.removeAllViewsInLayout: no requestLayout
      // AOSP ViewGroup detach/attach: only the parent link and child array change; no window detach, onViewRemoved/Added, or layout request (callers like RecyclerView re-attach or removeDetachedView later).
      if (name === 'detachViewFromParent' || name === 'detachViewsFromParent') {
        const view = method.parameters?.[0] === 'Landroid/view/View;'; let start = view ? object.children.findIndex(child => sameRef(child, args[1])) : args[1]; const count = name === 'detachViewsFromParent' ? args[2] : 1;
        if (start < 0 || count < 0 || start + count > object.children.length) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child range');
        for (const child of object.children.splice(start, count)) runtime.object(child).parent = null; return;
      }
      if (name === 'detachAllViewsFromParent') { for (const child of object.children.splice(0)) runtime.object(child).parent = null; return; }
      if (name === 'attachViewToParent') {
        if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', 'child'); const at = args[2] < 0 ? object.children.length : args[2];
        if (at > object.children.length) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child index');
        this.invoke(runtime, { owner: 'Landroid/view/View;', name: 'setLayoutParams' }, [args[1], args[3]]); runtime.object(args[1]).parent = receiver; object.children.splice(at, 0, args[1]); this.requestDraw(runtime, receiver); return;
      }
      if (name === 'removeDetachedView') {
        const child = runtime.object(args[1]); if (child.attached) { this.viewWindowHost.unfocusSubtree(runtime, args[1]); this.attachTree(runtime, args[1], false); }
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewRemoved', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); this.notifyHierarchyChange(runtime, receiver, args[1], false); return;
      }
      if (name === 'removeView' || name === 'removeViewInLayout') {
        if (!object.children.some(child => sameRef(child, args[1]))) return;
        const child = runtime.object(args[1]), disappearing = this.viewGroupApi.keepsDisappearing(runtime, receiver, args[1]);   // ViewGroup.removeViewInternal: a running Animation / view transition keeps the child attached and drawn until it ends
        if (child.attached) { this.viewWindowHost.unfocusSubtree(runtime, args[1]); if (!disappearing) this.attachTree(runtime, args[1], false); }
        const index = object.children.findIndex(value => sameRef(value, args[1])); if (index < 0) return; object.children.splice(index, 1); if (disappearing) this.viewGroupApi.addDisappearing(runtime, receiver, args[1]);
        if (sameRef(child.parent, receiver) && !(object.vg?.transitioning ?? []).some(view => sameRef(view, args[1]))) child.parent = null;
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewRemoved', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); this.notifyHierarchyChange(runtime, receiver, args[1], false); this.requestDraw(runtime, receiver); if (object.laidOut && name !== 'removeViewInLayout') this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]); return;
      }
      if (name === 'addView' || name === 'addViewInLayout') {
        const inLayout = name === 'addViewInLayout', preventLayout = inLayout && !!args[4];
        if (inLayout && nullish(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot add a null child view to a ViewGroup');
        if (inLayout) runtime.object(args[1]).parent = null;
        const child = runtime.object(args[1]); if (child.parent) runtime.throwJava('Ljava/lang/IllegalStateException;', 'View already has a parent');
        const indexed = method.parameters?.[1] === 'I', at = indexed && args[2] >= 0 ? args[2] : object.children.length; if (at > object.children.length) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child index');
        let params = indexed ? args[3] : args[2]; params ||= child.layoutParams;
        if (!params) params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateDefaultLayoutParams', signature: '()Landroid/view/ViewGroup$LayoutParams;', parameters: [], result: LAYOUT_PARAMS }, [receiver], 'virtual');
        if (!runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'checkLayoutParams', signature: `(${LAYOUT_PARAMS})Z`, parameters: [LAYOUT_PARAMS], result: 'Z' }, [receiver, params], 'virtual')) params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateLayoutParams', signature: `(${LAYOUT_PARAMS})${LAYOUT_PARAMS}`, parameters: [LAYOUT_PARAMS], result: LAYOUT_PARAMS }, [receiver, params], 'virtual');   // ViewGroup.addViewInner
        this.invoke(runtime, { owner: 'Landroid/view/View;', name: 'setLayoutParams' }, [args[1], params]); child.parent = receiver; object.children.splice(at, 0, args[1]); if (object.attached) this.attachTree(runtime, args[1], true);
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewAdded', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); this.notifyHierarchyChange(runtime, receiver, args[1], true); this.requestDraw(runtime, receiver);
        if (inLayout && !preventLayout) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [args[1]]);
        else if (!inLayout && runtime.objectOverride(object.type, 'requestLayout()V')) runtime.dispatch({ owner: object.type, name: 'requestLayout', signature: '()V', parameters: [], result: 'V' }, [receiver], 'virtual');   // a Java ViewGroup (RelativeLayout) learns of the change through its own requestLayout, laid out yet or not
        else if (!inLayout && object.laidOut) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]);
        return inLayout ? 1 : undefined;
      }
    }
    if (name === 'addOnAttachStateChangeListener') { (object.attachListeners ||= []).push(args[1]); return; }
    if (name === 'removeOnAttachStateChangeListener') { const listeners = object.attachListeners || [], index = listeners.findIndex(ref => sameRef(ref, args[1])); if (index >= 0) listeners.splice(index, 1); return; }
    if (name === 'isAttachedToWindow') return object.attached ? 1 : 0;
    if (name === 'onAttachedToWindow' || name === 'onDetachedFromWindow' || name === 'onVisibilityChanged' || name === 'onWindowVisibilityChanged') return;   // View's own bodies are empty hooks (onWindowVisibilityChanged only wakes scroll bars)
    if (name === 'getParent') return object.parent ?? null;
    if (name === 'setWillNotDraw') { object.willNotDraw = !!args[1]; return; } if (name === 'willNotDraw') return object.willNotDraw ? 1 : 0;
    if (name === 'setImportantForAutofill') { object.importantForAutofill = args[1]; return; } if (name === 'getImportantForAutofill') return object.importantForAutofill || 0;
    if (name === 'setImportantForAccessibility') { object.importantForAccessibility = args[1]; return; } if (name === 'getImportantForAccessibility') return object.importantForAccessibility || 0;
    if (name === 'isInEditMode') return 0;
    if (name === 'setImportantForContentCapture') { object.importantForContentCapture = args[1]; return; } if (name === 'getImportantForContentCapture') return object.importantForContentCapture || 0;
    if (name === 'getContentCaptureSession') return null;   // no ContentCaptureManager service on the virtual device: View.getContentCaptureSession() is null when capture is disabled
    if (name === 'setViewTranslationCallback') { object.viewTranslationCallback = args[1]; return; } if (name === 'clearViewTranslationCallback') { object.viewTranslationCallback = null; return; } if (name === 'getViewTranslationCallback') return object.viewTranslationCallback ?? null;
    if (name === 'setWindowInsetsAnimationCallback') { object.windowInsetsAnimationCallback = args[1]; return; }   // the virtual window has no insets animation driver: the callback is kept and never invoked
    if (name === 'getUniqueDrawingId') return BigInt(object.uniqueDrawingId ??= (this.nextUniqueDrawingId = (this.nextUniqueDrawingId ?? 0) + 1));
    if (name === 'setForceDarkAllowed') { object.forceDarkAllowed = !!args[1]; return; } if (name === 'isForceDarkAllowed') return object.forceDarkAllowed === false ? 0 : 1;
    if (name === 'awakenScrollBars') return 0;   // View.awakenScrollBars: the virtual window draws no scroll bars (returns false like a View with scroll bars disabled)
    if (name === 'setLayoutParams') { object.layoutParams = args[1]; const fields = runtime.object(args[1]).fields; const read = (name, type, fallback) => [...fields].find(([key]) => key.endsWith(`->${name}:${type}`))?.[1] ?? fallback; object.layoutWidth = read('width', 'I', -2); object.layoutHeight = read('height', 'I', -2); object.weight = bitsFloat(read('weight', 'F', 0)); object.layoutGravity = read('gravity', 'I', 0); object.margin = Object.fromEntries(['left', 'top', 'right', 'bottom'].map(edge => [edge, read(`${edge}Margin`, 'I', 0)])); this.drawableViewHost.afterLayout(runtime, receiver); return; }
    if (name === 'getLayoutParams') return object.layoutParams ?? null;
    if (name === 'setTag') { if (method.parameters.length === 1) object.tag = args[1]; else (object.keyedTags ||= new Map()).set(args[1], args[2]); return; }
    if (name === 'getTag') return method.parameters.length ? object.keyedTags?.get(args[1]) ?? null : object.tag ?? null;
    if (name === 'getVisibility') return object.visibility ?? 0;
    if (name === 'setVisibility') {
      if (![0, 4, 8].includes(args[1])) error('Invalid View visibility');
      const before = object.visibility ?? 0; object.visibility = args[1]; if (before === args[1]) return;
      // AOSP View.setVisibility: crossing GONE changes measured size, so the whole ancestor chain must re-measure/re-layout (a view that was GONE was never laid out); any change redraws.
      if ((before === 8) !== (args[1] === 8)) { // only under a hierarchy the original layout engine has already laid out (framework-less legacy rendering has no layout pass)
        let up = receiver, managed = false; for (let depth = 0; up && depth < 4096 && !managed; depth++) { managed = !!runtime.object(up).laidOut; up = runtime.object(up).parent; }
        if (managed) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]);
      }
      this.requestDraw(runtime, receiver); this.dialogWindowHost.visibilityChanged(runtime, receiver); return;
    }
    if (name === 'setBackgroundColor') { object.background = `#${(args[1] >>> 0).toString(16).padStart(8, '0')}`; return; }
    if (owner === 'Landroid/widget/ProgressBar;') { if (name === 'setMax') { object.max = Math.max(0, args[1]); object.progress = Math.min(object.progress || 0, object.max); return; } if (name === 'getMax') return object.max ?? 100; if (name === 'setProgress') { object.progress = Math.max(0, Math.min(object.max ?? 100, args[1])); return; } if (name === 'getProgress') return object.progress ?? 0; if (name === 'setIndeterminate') { object.indeterminate = !!args[1]; return; } return object.indeterminate ? 1 : 0; }
    if (name === 'setOnCheckedChangeListener') { object.checkedListener = args[1]; return; }
    if (name === 'setChecked' || name === 'toggle') return this.setChecked(runtime, receiver, name === 'toggle' ? !object.checked : !!args[1]);
    if (name === 'isChecked') return object.checked ? 1 : 0;
    if (name === 'addTextChangedListener') { (object.textWatchers ||= []).push(args[1]); return; }
    if (name === 'removeTextChangedListener') { object.textWatchers = (object.textWatchers || []).filter(ref => !sameRef(ref, args[1])); return; }
    if (name === 'getTypeface') {
      if (!runtime.skiaHost?.resolveTypeface) error('Typeface access requires the verified native font backend');
      if (object.typeface === undefined) object.typeface = runtime.dispatch({ owner: 'Landroid/graphics/Typeface;', name: 'defaultFromStyle', signature: '(I)Landroid/graphics/Typeface;', parameters: ['I'], result: 'Landroid/graphics/Typeface;' }, [object.textStyle || 0], 'static');
      return object.typeface;
    }
    if (name === 'getFilters') { if (!object.inputFilters) object.inputFilters = runtime.newArray('[Landroid/text/InputFilter;', 0); return object.inputFilters; }
    if (name === 'setFilters') { if (nullish(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'filters is null'); object.inputFilters = args[1]; return; }
    if (name === 'setTypeface') {
      if (!runtime.skiaHost?.resolveTypeface) error('Typeface requires the verified native font backend');
      let face = args[1]; if (method.parameters.length === 2 && args[2] > 0) face = runtime.dispatch({ owner: 'Landroid/graphics/Typeface;', name: 'create', signature: '(Landroid/graphics/Typeface;I)Landroid/graphics/Typeface;', parameters: ['Landroid/graphics/Typeface;', 'I'], result: 'Landroid/graphics/Typeface;' }, [face, args[2]], 'static');
      const info = runtime.skiaHost.resolveTypeface(face); object.typeface = face; object.textStyle = info.style; object.textFontWeight = info.weight; object.textFontItalic = info.italic; this.viewLayoutHost.invoke(runtime, { owner: 'Landroid/view/View;', name: 'requestLayout' }, [receiver]); this.requestDraw(runtime, receiver); return;
    }
    if (name === 'getTransformationMethod') return object.transformationMethod || null;
    if (name === 'setTransformationMethod') { object.transformationMethod = args[1]; this.updateTextTransformation(runtime, receiver); this.requestDraw(runtime, receiver); return; }
    if (name === 'setHint') { object.hint = args[1] ?? ''; return; } if (name === 'getHint') return object.hint ?? null;
    if (name === 'getId') return object.androidId ?? -1;
    if (name === 'setId') { object.androidId = args[1] >>> 0; return; }
    if (name === 'findViewById') return this.find(runtime, receiver, args[1]);
    if (name === 'getContext') return object.context ?? runtime.activity;
    if (name === 'setEnabled') { if (object.enabled !== !!args[1]) { object.enabled = !!args[1]; this.drawableViewHost.invoke(runtime, { owner: 'Landroid/view/View;', name: 'refreshDrawableState' }, [receiver]); this.requestDraw(runtime, receiver); } return; }
    if (name === 'isEnabled') return object.enabled === false ? 0 : 1;
    if (name === 'setPadding') { object.padding = { left: args[1], top: args[2], right: args[3], bottom: args[4] }; this.syncViewFields(runtime, receiver); return; }
    if (name.startsWith('getPadding')) return object.padding?.[name.slice(10).toLowerCase()] ?? 0;
    if (name === 'getText') { if (runtime.isSubtype(object.type, 'Landroid/widget/EditText;')) { const editable = this.editableTextHost.get(runtime, receiver); if (editable) return editable; } if (method.result === 'Landroid/text/Editable;') { if (!object.editable) { object.editable = runtime.makeObject(EDITABLE); runtime.object(object.editable).sourceView = receiver; } return object.editable; } return object.text; }
    if (name === 'setText') { const text = method.parameters[0] === 'I' ? args[1] === 0 ? '' : this.resource(args[1], ['string']).value : nullish(args[1]) ? '' : typeof args[1] === 'string' ? args[1] : runtime.javaString(args[1], method.parameters[0]); return this.setInput(runtime, object.id, text, { replaceBuffer: true, sourceValue: method.parameters[0] === 'I' ? text : args[1] ?? '' }); }
    if (name === 'setTextColor') { const color = `#${(args[1] >>> 0).toString(16).padStart(8, '0')}`; if (object.textColor !== color) { object.textColor = color; if (object.textRaster) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]); this.requestDraw(runtime, receiver); } return; }
    if (name === 'setTextSize') { if (![0, 1, 2].includes(args[1])) error('Only px/dp/sp TextView units are supported'); const raw = bitsFloat(args[2]), size = Math.fround(raw * (args[1] === 2 ? this.device.fontScale || 1 : 1)); /* TypedValue.applyDimension: sp uses scaledDensity = density * fontScale, dp/px density 1 */ if (!Number.isFinite(size) || size <= 0 || size > 200) error('Invalid TextView text size'); if (object.textSize !== size) { object.textSize = size; if (object.measuredDimensionSet) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]); this.requestDraw(runtime, receiver); } return; }
    error(`Unimplemented platform method ${owner}->${name}${method.signature}`);
  }
  /**
   * Bundle.getParcelable / getParcelableArray / getParcelableArrayList / getSparseParcelableArray / getSerializable with a Class (API 33, android-13.0.0_r1 Bundle.java + BaseBundle.getValue):
   * the stored value is cast to the container the getter promises (ClassCastException) and, for values that came out of a Parcel and were not read yet, every item is checked against the
   * requested class (BadTypeParcelableException). Both are caught by the getter: it logs "Key k expected ..." (BaseBundle.typeWarning) and answers null, so a mismatch never reaches the app
   * as an exception. A null Class is a NullPointerException (requireNonNull). A successful read of a parceled value materializes it: later reads are not item-checked again.
   */
  typedValue(runtime, holder, getter, key, clazzRef) {
    if (nullish(clazzRef)) runtime.throwJava('Ljava/lang/NullPointerException;', null);
    const wanted = runtime.object(clazzRef).classType ?? 'Ljava/lang/Object;', entries = this.extras(runtime, holder), entry = entries.get(checkString(key, 'Bundle/Intent key'));
    if (!entry || nullish(entry.value)) return null;
    const canonical = type => { let dims = 0; while (type.startsWith('[')) { dims++; type = type.slice(1); } const base = { I: 'int', J: 'long', Z: 'boolean', F: 'float', D: 'double', B: 'byte', C: 'char', S: 'short' }[type] ?? type.slice(1, -1).replaceAll('/', '.').replaceAll('$', '.'); return base + '[]'.repeat(dims); };
    const boxes = { I: 'Ljava/lang/Integer;', J: 'Ljava/lang/Long;', Z: 'Ljava/lang/Boolean;', F: 'Ljava/lang/Float;', D: 'Ljava/lang/Double;', B: 'Ljava/lang/Byte;', C: 'Ljava/lang/Character;', S: 'Ljava/lang/Short;' };
    const typeOf = value => (typeof value === 'string' ? 'Ljava/lang/String;' : runtime.typeOf(value)), instanceOf = (value, type) => nullish(value) || runtime.isSubtype(typeOf(value), type);
    const valueType = boxes[entry.type] ?? typeOf(entry.value);
    const label = { getParcelable: canonical(wanted), getSerializable: canonical(wanted), getParcelableArray: canonical(wanted) + '[]', getParcelableArrayList: `ArrayList<${canonical(wanted)}>`, getSparseParcelableArray: `SparseArray<${canonical(wanted)}>` }[getter];
    const mismatch = () => {   // BaseBundle.typeWarning(key, className, e)
      runtime.dispatch({ owner: 'Landroid/util/Log;', name: 'w', parameters: ['Ljava/lang/String;', 'Ljava/lang/String;'], result: 'I', signature: '(Ljava/lang/String;Ljava/lang/String;)I' }, ['Bundle', `Key ${key} expected ${label} but value was of a different type.  The default value <null> was returned.`], 'static');
      return null;
    };
    const container = { getParcelable: wanted, getSerializable: wanted, getParcelableArray: '[Landroid/os/Parcelable;', getParcelableArrayList: 'Ljava/util/ArrayList;', getSparseParcelableArray: 'Landroid/util/SparseArray;' }[getter];
    if (!container) error(`Unsupported typed getter ${getter}`);
    if (!runtime.isSubtype(valueType, container)) return mismatch();   // Class.cast: ClassCastException
    if (entry.lazy && getter !== 'getParcelable' && getter !== 'getSerializable') {   // item types are verified while a parceled value is read
      const call = (owner, name, parameters, result, receiver, extra = []) => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...extra], 'virtual');
      let items;
      if (getter === 'getParcelableArray') items = runtime.array(entry.value).elements;
      else if (getter === 'getParcelableArrayList') items = Array.from({ length: call('Ljava/util/ArrayList;', 'size', [], 'I', entry.value) }, (_, i) => call('Ljava/util/ArrayList;', 'get', ['I'], 'Ljava/lang/Object;', entry.value, [i]));
      else items = Array.from({ length: call('Landroid/util/SparseArray;', 'size', [], 'I', entry.value) }, (_, i) => call('Landroid/util/SparseArray;', 'valueAt', ['I'], 'Ljava/lang/Object;', entry.value, [i]));
      if (!items.every(item => instanceOf(item, wanted))) return mismatch();   // BadTypeParcelableException
    }
    if (entry.lazy) entry.lazy = false;
    return entry.value;
  }
  bundleInvoke(runtime, method, args) {
    const object = runtime.object(args[0]), name = method.name;
    if (name === '<init>') { const copy = method.parameters[0] === BUNDLE; object.extras = copy ? new Map(this.extras(runtime, args[1])) : new Map(); object.classLoader = copy ? runtime.object(args[1]).classLoader ?? null : null; return; }
    const entries = this.extras(runtime, args[0]);
    if (name === 'size') return entries.size;
    if (name === 'isEmpty') return entries.size ? 0 : 1;
    if (name === 'containsKey') return entries.has(checkString(args[1], 'Bundle key')) ? 1 : 0;
    if (name === 'remove') { if (entries.delete(checkString(args[1], 'Bundle key'))) object.bundleVersion = (object.bundleVersion || 0) + 1; return; }
    if (name === 'clear') { if (entries.size) object.bundleVersion = (object.bundleVersion || 0) + 1; entries.clear(); return; }
    if (name === 'putAll') { for (const [key, entry] of this.extras(runtime, args[1])) this.put(runtime, args[0], key, entry.type, entry.value); return; }
    if (name === 'clone') return this.bundle(runtime, entries, object.classLoader ?? null);
    if (name === 'deepCopy') { // AOSP Bundle.deepCopy: nested Bundles are copied recursively; other mutable container values are not modeled and fail explicitly.
      const copy = new Map(); for (const [key, entry] of entries) { let value = entry.value; if (entry.type === BUNDLE && !nullish(value)) value = this.bundleInvoke(runtime, { name: 'deepCopy', parameters: [] }, [value]); else if (entry.type.startsWith('[') || entry.type === 'Ljava/util/ArrayList;' || entry.type === 'Landroid/os/Parcelable;') error(`Bundle.deepCopy of ${entry.type} values is not modeled`); copy.set(key, { type: entry.type, value }); }
      return this.bundle(runtime, copy, object.classLoader ?? null);
    }
    if (name === 'keySet') { const set = runtime.makeObject(KEY_SET); runtime.object(set).bundleSource = args[0]; return set; }
    if (name === 'setClassLoader') { object.classLoader = args[1]; return; }
    if (name === 'getClassLoader') return object.classLoader ?? null;
    if (name === 'get') {
      const entry = entries.get(checkString(args[1], 'Bundle key')); if (!entry) return null;
      const boxed = { I: 'Ljava/lang/Integer;', Z: 'Ljava/lang/Boolean;', J: 'Ljava/lang/Long;', F: 'Ljava/lang/Float;', D: 'Ljava/lang/Double;' }[entry.type];
      if (!boxed) return entry.value;
      const value = runtime.makeObject(boxed); runtime.object(value).boxed = entry.value; return value;
    }
    if (name.startsWith('put')) return this.put(runtime, args[0], args[1], method.parameters[1], args[2]);
    if (name.startsWith('get') && method.parameters[1] === 'Ljava/lang/Class;') return this.typedValue(runtime, args[0], name, args[1], args[2]);
    if (name.startsWith('get')) {
      const type = method.result;
      const fallback = args.length > 2 ? args[2] : ['J', 'D'].includes(type) ? 0n : /^[ZIFBCS]$/.test(type) ? 0 : null;
      return this.get(runtime, args[0], args[1], type, fallback);
    }
    error(`Unsupported Bundle operation ${name}`);
  }
  updateTextTransformation(runtime, receiver) {
    const view = runtime.object(receiver); if (!view.transformationMethod) { view.displayText = view.text; return; }
    const value = runtime.dispatch({ owner: 'Landroid/text/method/TransformationMethod;', name: 'getTransformation', signature: '(Ljava/lang/CharSequence;Landroid/view/View;)Ljava/lang/CharSequence;', parameters: ['Ljava/lang/CharSequence;', 'Landroid/view/View;'], result: 'Ljava/lang/CharSequence;' }, [view.transformationMethod, view.text ?? '', receiver], 'virtual');
    view.displayText = nullish(value) ? '' : typeof value === 'string' ? value : runtime.javaString(value);
  }
  setInput(runtime, id, text, options = {}) {
    const receiver = { ref: id }, view = runtime.object(receiver);
    if (!runtime.isSubtype(view.type, 'Landroid/widget/TextView;') || typeof text !== 'string' || text.length > 100000) error('Invalid bounded text input');
    if (runtime.isSubtype(view.type, 'Landroid/widget/EditText;') && view.keyListenerInitialized && !view.keyListener && !options.replaceBuffer) error('This EditText has no KeyListener and is read-only for user input');
    const before = view.text || '', watchers = [...(view.textWatchers || [])]; let start = 0, end = 0;
    while (start < before.length && start < text.length && before[start] === text[start]) start++;
    while (end < before.length - start && end < text.length - start && before.at(-1 - end) === text.at(-1 - end)) end++;
    const removed = before.length - start - end, added = text.length - start - end;
    const invoke = (watcher, name, parameters, values) => runtime.dispatch({ owner: runtime.object(watcher).type, name, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [watcher, ...values], 'virtual');
    for (const watcher of watchers) invoke(watcher, 'beforeTextChanged', ['Ljava/lang/CharSequence;', 'I', 'I', 'I'], [before, start, removed, added]);
    this.editableTextHost.update(runtime, receiver, text, { ...options, start, removed, added });
    view.text = text; this.updateTextTransformation(runtime, receiver);
    if (view.measuredDimensionSet) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]);
    this.requestDraw(runtime, receiver);
    for (const watcher of watchers) invoke(watcher, 'onTextChanged', ['Ljava/lang/CharSequence;', 'I', 'I', 'I'], [text, start, removed, added]);
    runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'onTextChanged', signature: '(Ljava/lang/CharSequence;III)V', parameters: ['Ljava/lang/CharSequence;', 'I', 'I', 'I'], result: 'V' }, [receiver, text, start, removed, added], 'virtual');   // TextView.handleTextChanged: the watchers first, then the overridable hook
    if (watchers.length) { view.editable ??= runtime.makeObject(EDITABLE); if (!view.sourceEditable) runtime.object(view.editable).sourceView = receiver; for (const watcher of watchers) invoke(watcher, 'afterTextChanged', ['Landroid/text/Editable;'], [view.editable]); }
  }
  setChecked(runtime, receiver, checked) {
    const view = runtime.object(receiver); if (!!view.checked === checked) return;
    view.checked = checked;
    // CompoundButton.setChecked() calls refreshDrawableState(); without it the CHECKED state never reaches stateful drawables.
    this.drawableViewHost.invoke(runtime, { owner: 'Landroid/view/View;', name: 'refreshDrawableState' }, [receiver]); this.drawableViewHost.checkedChanged(runtime, receiver, checked); this.requestDraw(runtime, receiver);
    if (view.broadcasting || nullish(view.checkedListener)) return;
    view.broadcasting = true;
    try { runtime.dispatch({ owner: runtime.object(view.checkedListener).type, name: 'onCheckedChanged', signature: '(Landroid/widget/CompoundButton;Z)V', parameters: ['Landroid/widget/CompoundButton;', 'Z'], result: 'V' }, [view.checkedListener, receiver, checked ? 1 : 0], 'virtual'); }
    finally { view.broadcasting = false; }
  }
  performClick(runtime, receiver) {
    const view = runtime.object(receiver); if (!runtime.isSubtype(view.type, 'Landroid/widget/CompoundButton;')) return false;
    this.setChecked(runtime, receiver, !view.checked);
    if (!nullish(view.listener)) runtime.dispatch({ owner: runtime.object(view.listener).type, name: 'onClick', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [view.listener, receiver], 'virtual');
    return true;
  }
  checkInput(runtime, id, checked) {
    const receiver = { ref: id }, view = runtime.object(receiver);
    if (!runtime.isSubtype(view.type, 'Landroid/widget/CompoundButton;') || view.enabled === false) error('Invalid disabled/non-CompoundButton input');
    this.setChecked(runtime, receiver, !!checked);
    if (!nullish(view.listener)) runtime.dispatch({ owner: runtime.object(view.listener).type, name: 'onClick', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [view.listener, receiver], 'virtual');
  }
  attachTree(runtime, ref, attached, seen = new Set()) {
    if (!ref) return; const object = runtime.object(ref);
    if (seen.has(object.id) || seen.size >= 4096) error('Cyclic/excessive attachment hierarchy'); seen.add(object.id);
    // ViewGroup.dispatchAttachedToWindow runs the parent first; dispatchDetachedFromWindow runs the children first (Compose's AndroidViewHolder needs its owner while detaching).
    if (!attached) for (const child of [...object.children]) this.attachTree(runtime, child, false, seen);
    if (!!object.attached !== attached) {
      // View.dispatchDetachedFromWindow keeps mAttachInfo (isAttachedToWindow() == true) through onDetachedFromWindow and the OnAttachStateChangeListeners; it is cleared last.
      if (attached) object.attached = true;
      this.viewWindowHost.afterAttach(runtime, ref, attached);
      this.insetsHost.afterAttach(runtime, ref, attached);
      this.viewLayoutHost.afterAttach(runtime, ref, attached);
      this.viewInputHost.afterAttach(runtime, ref, attached);
      runtime.dispatch({ owner: object.type, name: attached ? 'onAttachedToWindow' : 'onDetachedFromWindow', signature: '()V', parameters: [], result: 'V' }, [ref], 'virtual');
      this.drawableViewHost.afterAttach(runtime, ref, attached);
      this.viewTreeHost.afterAttach(runtime, ref, attached);
      for (const listener of [...(object.attachListeners || [])]) runtime.dispatch({ owner: runtime.object(listener).type, name: attached ? 'onViewAttachedToWindow' : 'onViewDetachedFromWindow', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [listener, ref], 'virtual');
      if (!attached) object.attached = false;
    }
    if (attached) for (const child of [...object.children]) this.attachTree(runtime, child, true, seen);
  }
  notifyActivity(runtime, frame, event, bundle) {
    const parameters = [ACTIVITY]; const values = [frame.activity];
    if (/(Created|SaveInstanceState)$/.test(event)) { parameters.push(BUNDLE); values.push(bundle || null); }
    // Activity.dispatchActivityX: the callbacks registered on the Activity first (API 29+), then the Application's. The Pre*/Post* callbacks are interface default methods:
    // a callback class that does not declare one gets the empty default.
    const callbacks = [...(runtime.object(frame.activity).activityCallbacks ?? []), ...this.applicationCallbacks], name = `onActivity${event}`, signature = `(${parameters.join('')})V`;
    for (const callback of callbacks) {
      if (/^(Pre|Post)/.test(event) && !this.declaresMethod(runtime, runtime.object(callback).type, name + signature)) continue;
      runtime.dispatch({ owner: runtime.object(callback).type, name, signature, parameters, result: 'V' }, [callback, ...values], 'virtual');
    }
  }
  /** ViewGroup.dispatchViewAdded / dispatchViewRemoved: after the onViewAdded / onViewRemoved hook, the OnHierarchyChangeListener hears about the child. */
  notifyHierarchyChange(runtime, group, child, added) {
    const listener = runtime.object(group).hierarchyChangeListener; if (nullish(listener)) return;
    const name = added ? 'onChildViewAdded' : 'onChildViewRemoved', parameters = ['Landroid/view/View;', 'Landroid/view/View;'];
    runtime.dispatch({ owner: runtime.object(listener).type, name, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [listener, group, child], 'virtual');
  }
  declaresMethod(runtime, type, key) { for (let at = type, depth = 0; at && depth < 64; at = runtime.parent(at), depth++) if (runtime.classes.get(at)?.methods.has(key)) return true; return false; }
  /** ActivityThread.performX: Activity.dispatchActivityPre<Event> -> the lifecycle method -> Post<Event> (Pre/Post callbacks exist since API 29; AndroidX Lifecycle's ReportFragment relies on them). */
  performLifecycle(runtime, receiver, name, values, run) {
    const events = { onCreate: 'Created', onStart: 'Started', onResume: 'Resumed', onPause: 'Paused', onStop: 'Stopped', onDestroy: 'Destroyed', onSaveInstanceState: 'SaveInstanceState' };
    const event = events[name], frame = event && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY) ? this.allFrames().find(f => sameRef(f.activity, receiver)) : null;
    if (!frame) return run();
    const bundle = /(Created|SaveInstanceState)$/.test(event) ? (values[0] ?? null) : undefined, legacy = runtime.apiLevel < 29;
    frame.lifecycleDepth = (frame.lifecycleDepth ?? 0) + 1;
    let result;
    try {
      if (!legacy) this.notifyActivity(runtime, frame, `Pre${event === 'SaveInstanceState' ? 'SaveInstanceState' : event}`, bundle);
      result = run();
      if (!legacy) this.notifyActivity(runtime, frame, `Post${event}`, bundle);
    } finally { frame.lifecycleDepth--; }
    if (frame.lifecycleDepth === 0 && frame.finishRequested && !frame.finishing) { frame.finishRequested = false; this.finish(runtime, frame.activity); }
    return result;
  }
  lifecycleCall(runtime, receiver, name, parameters = [], values = []) {
    const activity = runtime.isSubtype(runtime.object(receiver).type, ACTIVITY), frame = activity ? this.allFrames().find(frame => sameRef(frame.activity, receiver)) : null;
    const before = { onPause: 3, onStop: 2, onDestroy: 0 };
    if (frame && Object.hasOwn(before, name)) { if (name === 'onDestroy') frame.destroyed = true; this.moveFragments(runtime, frame, before[name]); }
    const result = this.performLifecycle(runtime, receiver, name, values, () => runtime.dispatch({ owner: runtime.object(receiver).type, name, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [receiver, ...values], 'virtual'));
    // ActivityThread.handleDestroyActivity: fragments and Activity.onDestroy run first (Compose disposes its compositions there), the window is removed afterwards.
    if (frame && name === 'onDestroy') { if (frame.root) this.viewWindowHost.unfocusSubtree(runtime, frame.root); this.attachTree(runtime, frame.root, false); this.dialogWindowHost.activityDestroyed(runtime, receiver); this.strictModeActivity(runtime, receiver, 'destroyed'); }
    if (frame && (name === 'onPause' || name === 'onStop') && this.appData) { if (name === 'onStop') this.appData.finishQueuedWork(); this.appData.syncPoint(name); }   // app-data persistence (src/app-data-store.js)
    if (frame && name === 'onStart') this.moveFragments(runtime, frame, 3);
    if (frame && name === 'onResume') { this.moveFragments(runtime, frame, 4); this.lifecycleCall(runtime, receiver, 'onPostResume'); }
    return result;
  }
  /** ActivityThread's StrictMode bookkeeping: a launched Activity is tracked and expected (detectActivityLeaks), a destroyed one stops being expected and the instance-count limits are checked (the
   *  main-looper idle handler of StrictMode.setVmPolicy runs after each destroy). All of it is the original StrictMode in framework.dex; with no VM policy the calls return at once. */
  strictModeActivity(runtime, activity, event) {
    if (!runtime.classes.has('Landroid/os/StrictMode;')) return;
    const type = runtime.object(activity).type, call = (name, parameters, result, args) => runtime.dispatch({ owner: 'Landroid/os/StrictMode;', name, signature: `(${parameters.join('')})${result}`, parameters, result }, args, 'static');
    const muted = runtime.traceMuted; runtime.traceMuted = true;   // bookkeeping the app never sees must not evict APK-visible trace entries
    try {
      if (event === 'created') { call('trackActivity', ['Ljava/lang/Object;'], 'Ljava/lang/Object;', [activity]); call('incrementExpectedActivityCount', ['Ljava/lang/Class;'], 'V', [runtime.classObject(type)]); }
      else { call('decrementExpectedActivityCount', ['Ljava/lang/Class;'], 'V', [runtime.classObject(type)]); call('conditionallyCheckInstanceCounts', [], 'V', []); }
    } finally { runtime.traceMuted = muted; }
  }
  /** The frame is still the live instance of its task: not finishing, finished, destroyed or replaced. */
  launchAlive(frame) { return !frame.finished && !frame.destroyed && !frame.finishing && !frame.finishRequested && !frame.finishQueued && !this.finishedActivities.has(frame.activity.ref) && this.allFrames().includes(frame); }
  afterActivityCreate(runtime, activity = runtime.activity) {
    if (this.finishedActivities.has(activity?.ref)) return; const frame = this.frame(runtime, activity); if (frame.lifecycleStage >= 2) return; frame.lifecycleStage = 2; this.moveFragments(runtime, frame, 2);
    // ActivityThread checks mFinished after every step of the launch (performLaunchActivity, handleStartActivity, performResumeActivity): an Activity that finished (or was replaced) inside onCreate / onStart /
    // onRestoreInstanceState / onPostCreate is already torn down by then and gets none of the following callbacks.
    const alive = () => this.launchAlive(frame);
    if (!alive()) return; this.lifecycleCall(runtime, activity, 'onStart');
    if (alive() && frame.savedState) this.lifecycleCall(runtime, activity, 'onRestoreInstanceState', [BUNDLE], [frame.savedState]);
    if (alive()) this.lifecycleCall(runtime, activity, 'onPostCreate', [BUNDLE], [frame.savedState || null]);
    if (!alive()) return; this.lifecycleCall(runtime, activity, 'onResume');
    if (alive() && runtime.activity && sameRef(runtime.activity, activity)) { this.attachTree(runtime, frame.root, true); this.viewTreeHost.dispatchFrame(runtime, frame.root, () => { this.drawableViewHost.drawTree(runtime, frame.root); this.composeCanvasHost.renderTree(runtime, frame.root); }); }
  }
  rtNodeState(runtime, handle) { return renderNodeByHandle(runtime, handle); }
  /** Redraw every window: RenderThread animators changed CanvasProperty / RenderNode values that the recorded display lists read at replay. */
  redrawAll(runtime) { for (const { root } of this.viewRoots(runtime)) this.requestDraw(runtime, root); }
  requestDraw(runtime, receiver, delay = 0) {
    const view = runtime.object(receiver); view.invalidated = true; this.composeCanvasHost.markDirty(runtime,receiver);
    if (!view.attached) return;
    if (!runtime.classes.has('Landroid/view/ViewTreeObserver;') && !view.imageDrawable && !view.backgroundDrawable) return;
    const root=this.dialogWindowHost.recordFor(runtime,receiver)?.root||runtime.root;if(!root)return;
    this.drawRootsQueued??=new Set();if(this.drawRootsQueued.has(root.ref))return;this.drawRootsQueued.add(root.ref);
    this.queueTask(() => {
      this.drawRootsQueued.delete(root.ref);
      if(this.taskClosed||!runtime.object(root).attached||!this.viewRoots(runtime).some(value=>sameRef(value.root,root)))return;
      const draw=()=>{this.drawableViewHost.drawTree(runtime,root);this.composeCanvasHost.renderTree(runtime,root);};
      if(runtime.classes.has('Landroid/view/ViewTreeObserver;')){if(!this.viewTreeHost.dispatchFrame(runtime,root,draw)){this.requestDraw(runtime,root,1000/60);return;}}else draw();
      runtime.object(root).invalidated=false;
    },delay,[root]);
  }
  /** `roots`: the Java values the callback closes over (the heap collector cannot inspect closures; a task without a roots list blocks collection). */
  queueTask(callback, delay = 0, roots = undefined, { ui = false, deferred = false } = {}) {
    if (roots === undefined && this.vmRuntime) {   // an unannotated closure may capture Java values: root what the enqueuing code could hold (registers + its latest host allocations) and count the site
      roots = this.vmRuntime.conservativeTaskRoots();
      const frames = this.vmRuntime.thread?.frames, site = frames?.length ? String(frames.at(-1).method?.key ?? '?').replace(/^L/, '').replace(/;->/, '.') : (callback.name || 'host');
      const sites = this.anonymousTaskSites ??= new Map(); if (sites.size < 200 || sites.has(site)) sites.set(site, (sites.get(site) ?? 0) + 1);
    }
    // The host event is a Message of the main Looper's MessageQueue (looper-host.js). Java code is not run while the collector is finishing or before a runtime exists: such tasks are sent at the next pump.
    const event = { when: this.clock.now() + delay, sequence: ++this.eventSequence, front: false, platformTask: callback, ...(ui ? { ui: true } : {}), ...(roots !== undefined ? { roots } : {}) };
    if (deferred || !this.vmRuntime || !this.looperHost.started()) { this.looperHost.defer(event, delay); return; }
    const now = this.clock.now();   // a delayed task is never early by the whole-millisecond granularity of Message.when; a task due now is due now
    this.looperHost.postAt(this.vmRuntime, event, delay > 0 ? Math.ceil(now + delay) : Math.floor(now), { asynchronous: ui });
  }
  captureViewState(runtime, root, result = []) {
    if (!root) return result; const view = runtime.object(root);
    if (view.saveEnabled !== false && view.androidId && (runtime.isSubtype(view.type, 'Landroid/widget/EditText;') || runtime.isSubtype(view.type, 'Landroid/widget/CompoundButton;') || view.type === 'Landroid/widget/ProgressBar;')) result.push({ androidId: view.androidId, text: view.text, checked: view.checked, progress: view.progress });
    for (const child of view.children) if (runtime.object(child).saveFromParentEnabled !== false) this.captureViewState(runtime, child, result); return result;
  }
  restoreViewState(runtime, root, state = []) {
    for (const saved of state) { const ref = this.find(runtime, root, saved.androidId); if (!ref) continue; const view = runtime.object(ref); if (runtime.isSubtype(view.type, 'Landroid/widget/EditText;')) this.setInput(runtime, view.id, saved.text); if (runtime.isSubtype(view.type, 'Landroid/widget/CompoundButton;')) this.setChecked(runtime, ref, !!saved.checked); if (view.type === 'Landroid/widget/ProgressBar;') view.progress = saved.progress; }
  }
  recreateActivity(runtime, frame) {
    if (!this.allFrames().includes(frame)) return; this.syncCurrent(runtime); frame.changingConfiguration = true;
    if (frame.lifecycleStage === 4) this.lifecycleCall(runtime, frame.activity, 'onPause'); if (frame.lifecycleStage !== 2) this.lifecycleCall(runtime, frame.activity, 'onStop'); const saved = this.bundle(runtime);
    this.lifecycleCall(runtime, frame.activity, 'onSaveInstanceState', [BUNDLE], [saved]);
    const retained = runtime.dispatch({ owner: frame.type, name: 'onRetainNonConfigurationInstance', signature: '()Ljava/lang/Object;', parameters: [], result: 'Ljava/lang/Object;' }, [frame.activity], 'virtual');
    const retainedFragments = frame.fragmentManager ? runtime.object(frame.fragmentManager).fragments.filter(ref => runtime.object(ref).retained) : [];
    for (const fragment of retainedFragments) runtime.object(fragment).retaining = true;
    this.lifecycleCall(runtime, frame.activity, 'onDestroy');
    const activity = runtime.allocate(frame.type), replacement = { activity, type: frame.type, intent: frame.intent, root: null, retained, lifecycleStage: 0, savedState: saved, record: frame.record, resultReceiver: frame.resultReceiver, resultRequestCode: frame.resultRequestCode, fragmentRequests: frame.fragmentRequests, launchFlags: frame.launchFlags, noHistory: frame.noHistory, overrideTransition: frame.overrideTransition };
    { const task = this.taskOf(frame); task.frames.splice(task.frames.indexOf(frame), 1, replacement); } this.finishedActivities.add(frame.activity.ref);
    if (retainedFragments.length) { const manager = this.fragmentManager(runtime, replacement); runtime.object(manager).fragments = retainedFragments; for (const fragment of retainedFragments) Object.assign(runtime.object(fragment), { host: activity, manager, fragmentStage: 0, skipCreateOnce: true, retaining: false }); }
    runtime.activity = activity; runtime.activityType = frame.type; runtime.root = null;
    runtime.dispatch({ owner: frame.type, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [activity], 'direct');
    this.attachActivityContext(runtime, activity);
    this.lifecycleCall(runtime, activity, 'onCreate', [BUNDLE], [saved]); this.afterActivityCreate(runtime, activity); replacement.root = runtime.root;
  }
  locale(runtime, languageTag) {
    this.localeCache ||= new Map();
    const tag = languageTag === 'und' || !languageTag ? 'und' : Intl.getCanonicalLocales(String(languageTag))[0];
    if (!this.localeCache.has(tag)) { const info = new Intl.Locale(tag), value = runtime.makeObject(LOCALE); runtime.object(value).localeData = { language: info.language === 'und' ? '' : info.language, country: info.region || '', script: info.script || '', variant: '', tag }; this.localeCache.set(tag, value); }
    return this.localeCache.get(tag);
  }
  localeList(runtime, locales) { if (runtime.classes.has(LOCALES)) { const array = runtime.newArray('[Ljava/util/Locale;', locales.length); runtime.object(array).elements = [...locales]; const value = runtime.allocate(LOCALES); runtime.dispatch({ owner: LOCALES, name: '<init>', signature: '([Ljava/util/Locale;)V', parameters: ['[Ljava/util/Locale;'], result: 'V' }, [value, array], 'direct'); return value; } const value = runtime.makeObject(LOCALES); runtime.object(value).locales = [...locales]; return value; }
  metrics(runtime) {
    if (this.displayMetrics) return this.displayMetrics;
    if ((runtime.classes || runtime.dex.classes).has(METRICS)) { this.displayMetrics = runtime.allocate(METRICS); runtime.dispatch({ owner: METRICS, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [this.displayMetrics], 'direct'); }
    else this.displayMetrics = runtime.makeObject(METRICS);
    const fields = runtime.object(this.displayMetrics).fields;
    for (const [name, value] of Object.entries({ widthPixels: this.device.widthDp, heightPixels: this.device.heightDp, densityDpi: 160, noncompatWidthPixels: this.device.widthDp, noncompatHeightPixels: this.device.heightDp, noncompatDensityDpi: 160 })) runtime.storeField(fields, `${METRICS}->${name}:I`, value);
    for (const [name, value] of Object.entries({ density: 1, scaledDensity: this.device.fontScale || 1, xdpi: 160, ydpi: 160, noncompatDensity: 1, noncompatScaledDensity: this.device.fontScale || 1, noncompatXdpi: 160, noncompatYdpi: 160 })) runtime.storeField(fields, `${METRICS}->${name}:F`, floatBits(value));
    return this.displayMetrics;
  }
  aospDimension(runtime, value, name) {
    while (value.resolved) value = value.resolved;
    const result = name === 'complexToDimension' ? 'F' : 'I';
    return runtime.dispatch({ owner: 'Landroid/util/TypedValue;', name, signature: `(ILandroid/util/DisplayMetrics;)${result}`, parameters: ['I', METRICS], result }, [value.rawData, this.metrics(runtime)], 'static');
  }
  infoField(runtime, target, owner, name, type, value) { const field = runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }); runtime.storeField(runtime.object(target).fields, field.key, value); }
  /** The app's ApplicationInfo. `withMeta` mirrors PackageManager.GET_META_DATA: without it (or from a PackageManager call that did not ask) metaData is null, like the real parcel. */
  applicationInfo(runtime, withMeta = true) {
    const slot = withMeta ? 'appInfoWithMeta' : 'appInfo';
    if (this[slot]) return this[slot];
    if (!this.manifest) error('Actual parsed manifest metadata is unavailable for ApplicationInfo');
    const info = this[slot] = runtime.makeObject(APPLICATION_INFO); const app = this.manifest.application || {}, put = (name, type, value) => this.infoField(runtime, info, APPLICATION_INFO, name, type, value);
    if (withMeta) put('metaData', 'Landroid/os/Bundle;', this.appServices.metaDataBundle(runtime, app.metaData ?? []));
    put('packageName', 'Ljava/lang/String;', this.packageName); put('name', 'Ljava/lang/String;', this.applicationName); put('theme', 'I', Number(app.theme || 0));
    // android:label / android:icon: a resource reference (number) goes to labelRes/icon, a literal string to nonLocalizedLabel (PackageParser.parseBaseApplication)
    put('labelRes', 'I', typeof app.label === 'number' ? app.label : 0); put('nonLocalizedLabel', 'Ljava/lang/CharSequence;', typeof app.label === 'string' ? app.label : null); put('icon', 'I', typeof app.icon === 'number' ? app.icon : 0); put('targetSdkVersion', 'I', Number(this.manifest.usesSdk?.targetSdkVersion || 1)); put('uid', 'I', this.virtualProcess.uid);
    // ApplicationInfo install locations as PackageManager reports them for a package installed from this APK (virtual filesystem paths).
    const pkg = this.packageName, code = this.javaIo.fs().codePath, data = `/data/user/0/${pkg}`;
    for (const [name, value] of Object.entries({ sourceDir: `${code}/base.apk`, publicSourceDir: `${code}/base.apk`, dataDir: data, deviceProtectedDataDir: `/data/user_de/0/${pkg}`, credentialProtectedDataDir: data, nativeLibraryDir: `${code}/lib/wasm32`, processName: pkg, taskAffinity: pkg })) put(name, 'Ljava/lang/String;', value);
    // FLAG_DEBUGGABLE=2, FLAG_HAS_CODE=4, FLAG_ALLOW_CLEAR_USER_DATA=0x40, FLAG_INSTALLED=1<<23, FLAG_EXTRACT_NATIVE_LIBS=1<<28 (default when extractNativeLibs is not declared false).
    const isFalse = value => value === false || value === 'false' || value === 0, hasCode = !isFalse(app.hasCode);
    put('flags', 'I', (app.debuggable === true || app.debuggable === 'true' || (Number.isInteger(app.debuggable) && app.debuggable !== 0) ? 2 : 0) | (hasCode ? 4 : 0) | 0x40 | (1 << 23) | (isFalse(app.extractNativeLibs) ? 0 : (1 << 28)));
    put('minSdkVersion', 'I', Number(this.manifest.usesSdk?.minSdkVersion || 1)); put('enabled', 'Z', 1); put('category', 'I', Number.isInteger(app.appCategory) ? app.appCategory : -1);   // android:appCategory, else CATEGORY_UNDEFINED
    return info;
  }
  /** Configuration values of the virtual device now (screen size minus the current system-bar insets). */
  deviceConfiguration(runtime) { const frame = this.frames.at(-1), bars = frame?.root || frame?.window ? this.systemBarsHost.describe(runtime, frame) : null; return configurationFor(this.device, bars?.insets); }
  /** DisplayMetrics follow the device size (the object is shared, so Resources.getDisplayMetrics() sees live changes). */
  updateMetrics(runtime) {
    if (!this.displayMetrics) return; const fields = runtime.object(this.displayMetrics).fields;
    for (const [name, value] of Object.entries({ widthPixels: this.device.widthDp, heightPixels: this.device.heightDp, noncompatWidthPixels: this.device.widthDp, noncompatHeightPixels: this.device.heightDp })) runtime.storeField(fields, `${METRICS}->${name}:I`, value);

    // ResourcesImpl.updateConfiguration: scaledDensity = density * fontScale (linear, Android 13); sp values resolve through it.
    for (const name of ['scaledDensity', 'noncompatScaledDensity']) runtime.storeField(fields, `${METRICS}->${name}:F`, floatBits(this.device.fontScale || 1));
  }
  initializeConfiguration(runtime, value) {
    const fields = runtime.object(value).fields;
    const wanted = this.deviceConfiguration(runtime);
    for (const name of ['densityDpi', 'screenWidthDp', 'screenHeightDp', 'smallestScreenWidthDp', 'orientation', 'uiMode', 'screenLayout']) runtime.storeField(fields, `${CONFIGURATION}->${name}:I`, wanted[name]);
    if (runtime.classes.has('Landroid/graphics/Rect;')) { const key = `${CONFIGURATION}->windowConfiguration:Landroid/app/WindowConfiguration;`, existing = fields.get(key), configured = this.deviceServices.createWindowConfiguration(runtime, existing); if (!existing) runtime.storeField(fields, key, configured); }
    runtime.storeField(fields, `${CONFIGURATION}->fontScale:F`, floatBits(wanted.fontScale)); runtime.storeField(fields, `${CONFIGURATION}->locale:${LOCALE}`, this.locale(runtime, wanted.locale)); runtime.storeField(fields, `${CONFIGURATION}->mLocaleList:${LOCALES}`, this.localeList(runtime, [this.locale(runtime, wanted.locale)]));
  }
  layoutParamsFromAttributes(runtime, parent, attrs, target = null, context = null, typeOverride = null) {
    const view = parent ? runtime.object(parent) : { context }, linear = !!view.type && runtime.isSubtype(view.type, 'Landroid/widget/LinearLayout;'), frame = !!view.type && runtime.isSubtype(view.type, 'Landroid/widget/FrameLayout;');
    const type = typeOverride || (linear ? 'Landroid/widget/LinearLayout$LayoutParams;' : frame ? 'Landroid/widget/FrameLayout$LayoutParams;' : MARGIN_PARAMS);
    const names = ['layout_width', 'layout_height', 'layout_margin', 'layout_marginLeft', 'layout_marginTop', 'layout_marginRight', 'layout_marginBottom', 'layout_gravity', 'layout_weight'];
    const table = this.resources.frameworkTable || this.resources.table, ids = runtime.newArray('[I', names.length); runtime.object(ids).elements = names.map(name => { const id = table.findId('attr/' + name); if (!id) error(`Framework attribute ID ${name} unavailable`); return id; });
    const array = this.styleBackend.obtain(runtime, this.styleBackend.theme(runtime, view.context), attrs, ids);
    const get = (name, parameters, result, values) => runtime.dispatch({ owner: 'Landroid/content/res/TypedArray;', name, parameters, result, signature: `(${parameters.join('')})${result}` }, [array, ...values], 'virtual');
    const ref = target || runtime.makeObject(type), fields = runtime.object(ref).fields;
    try {
      for (const [i, name] of ['width', 'height'].entries()) runtime.storeField(fields, `${LAYOUT_PARAMS}->${name}:I`, get('getLayoutDimension', ['I', 'Ljava/lang/String;'], 'I', [i, 'layout_' + name]));
      const margin = get('getDimensionPixelSize', ['I', 'I'], 'I', [2, 0]);
      for (const [i, edge] of ['left', 'top', 'right', 'bottom'].entries()) runtime.storeField(fields, `${MARGIN_PARAMS}->${edge}Margin:I`, get('getDimensionPixelSize', ['I', 'I'], 'I', [i + 3, margin]));
      if (linear || frame) runtime.storeField(fields, `${type}->gravity:I`, get('getInt', ['I', 'I'], 'I', [7, -1]));
      if (linear) runtime.storeField(fields, `${type}->weight:F`, get('getFloat', ['I', 'F'], 'F', [8, 0]));
    } finally { get('recycle', [], 'V', []); }
    return ref;
  }
  inflater(runtime, context, visited = new Set()) {
    const key = context.ref; ephemeronMap(runtime, this.inflaters); if (this.inflaters.has(key)) return this.inflaters.get(key);   // a finished Activity's inflater must not keep its view tree alive
    if (visited.has(key) || visited.size >= 64) error('Cyclic/excessive ContextWrapper inflater chain'); visited = new Set(visited); visited.add(key);
    const source = 'Lcom/android/internal/policy/PhoneLayoutInflater;', original = runtime.classes.has(source), object = runtime.object(context);
    if (original && object.baseContext && !runtime.isSubtype(object.type, ACTIVITY)) {
      const base = this.inflater(runtime, object.baseContext, visited), inflater = runtime.dispatch({ owner: INFLATER, name: 'cloneInContext', signature: '(Landroid/content/Context;)Landroid/view/LayoutInflater;', parameters: ['Landroid/content/Context;'], result: INFLATER }, [base, context], 'virtual');
      runtime.object(inflater).context = context; this.inflaters.set(key, inflater); return inflater;
    }
    const inflater = original ? runtime.allocate(source) : runtime.makeObject(INFLATER); runtime.object(inflater).context = context;
    if (original) {
      runtime.dispatch({ owner: source, name: '<init>', signature: '(Landroid/content/Context;)V', parameters: ['Landroid/content/Context;'], result: 'V' }, [inflater, context], 'direct');
      if (runtime.isSubtype(object.type, ACTIVITY)) runtime.dispatch({ owner: INFLATER, name: 'setPrivateFactory', signature: '(Landroid/view/LayoutInflater$Factory2;)V', parameters: ['Landroid/view/LayoutInflater$Factory2;'], result: 'V' }, [inflater, context], 'virtual');
    }
    this.inflaters.set(key, inflater); return inflater;
  }

  window(runtime, frame) {
    if (!frame.window) {
      frame.window = runtime.makeObject(WINDOW); const decor = runtime.makeObject('Landroid/widget/FrameLayout;'), content = runtime.makeObject('Landroid/widget/FrameLayout;');
      runtime.object(content).androidId = 0x01020002; runtime.object(content).children = frame.root ? [frame.root] : [];
      runtime.object(decor).children = [content]; runtime.object(content).parent = decor; Object.assign(runtime.object(frame.window), { host: frame.activity, callback: frame.activity, decor, content, features: new Set([0, 6]), decorRequested: false });
    }
    return frame.window;
  }
  fragmentManager(runtime, frame) {
    if (!frame.fragmentManager) { frame.fragmentManager = runtime.makeObject(FRAGMENT_MANAGER); Object.assign(runtime.object(frame.fragmentManager), { host: frame.activity, fragments: [], pending: [], destroyed: false }); }
    return frame.fragmentManager;
  }
  fragmentCall(runtime, fragment, name, parameters = [], args = []) { return this.lifecycleCall(runtime, fragment, name, parameters, args); }
  /** FragmentManager.FragmentLifecycleCallbacks (registerFragmentLifecycleCallbacks): called around each lifecycle step of a fragment of the manager, in FragmentManager.dispatchOnFragment* order. */
  notifyFragment(runtime, value, event, extraTypes = [], extra = []) {
    const manager = runtime.object(value).manager; if (nullish(manager)) return;
    const callbacks = runtime.object(manager).callbacks; if (!callbacks?.length) return;
    for (const entry of [...callbacks]) {
      const parameters = [FRAGMENT_MANAGER, FRAGMENT, ...extraTypes];
      runtime.dispatch({ owner: FRAGMENT_CALLBACKS, name: event, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [entry.callbacks, manager, value, ...extra], 'virtual');
    }
  }
  moveFragment(runtime, value, target) {
    const fragment = runtime.object(value); let state = fragment.fragmentStage || 0;
    while (state < target) {
      const next = state + 1;
      if (next === 1) {
        this.notifyFragment(runtime, value, 'onFragmentPreAttached', ['Landroid/content/Context;'], [fragment.host]); this.fragmentCall(runtime, value, 'onAttach', ['Landroid/content/Context;'], [fragment.host]); this.notifyFragment(runtime, value, 'onFragmentAttached', ['Landroid/content/Context;'], [fragment.host]);
        if (!fragment.skipCreateOnce) { this.notifyFragment(runtime, value, 'onFragmentPreCreated', [BUNDLE], [null]); this.fragmentCall(runtime, value, 'onCreate', [BUNDLE], [null]); this.notifyFragment(runtime, value, 'onFragmentCreated', [BUNDLE], [null]); } fragment.skipCreateOnce = false;
      }
      // The Activity that owns the fragment's FragmentManager, never a global current Activity; a fragment with no owner left (detached) has no view to create.
      if (next === 2 && nullish(fragment.host ?? (nullish(fragment.manager) ? null : runtime.object(fragment.manager).host))) { state = fragment.fragmentStage = next; continue; }
      if (next === 2) { fragment.host ??= runtime.object(fragment.manager).host; const frame = this.frame(runtime, fragment.host); const container = fragment.containerId ? this.find(runtime, frame.root, fragment.containerId) : null; fragment.root = runtime.dispatch({ owner: runtime.object(value).type, name: 'onCreateView', signature: '(Landroid/view/LayoutInflater;Landroid/view/ViewGroup;Landroid/os/Bundle;)Landroid/view/View;', parameters: [INFLATER, 'Landroid/view/ViewGroup;', BUNDLE], result: 'Landroid/view/View;' }, [value, this.inflater(runtime, fragment.host), container, frame.savedState || null], 'virtual'); if (!nullish(fragment.root)) { if (container) runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'addView', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [container, fragment.root], 'virtual'); this.fragmentCall(runtime, value, 'onViewCreated', ['Landroid/view/View;', BUNDLE], [fragment.root, frame.savedState || null]); this.notifyFragment(runtime, value, 'onFragmentViewCreated', ['Landroid/view/View;', BUNDLE], [fragment.root, frame.savedState || null]); } this.fragmentCall(runtime, value, 'onActivityCreated', [BUNDLE], [frame.savedState || null]); this.notifyFragment(runtime, value, 'onFragmentActivityCreated', [BUNDLE], [frame.savedState || null]); }
      if (next === 3) { this.fragmentCall(runtime, value, 'onStart'); this.notifyFragment(runtime, value, 'onFragmentStarted'); }
      if (next === 4) { this.fragmentCall(runtime, value, 'onResume'); this.notifyFragment(runtime, value, 'onFragmentResumed'); }
      state = fragment.fragmentStage = next;
    }
    while (state > target) {
      if (state === 4) { this.fragmentCall(runtime, value, 'onPause'); this.notifyFragment(runtime, value, 'onFragmentPaused'); }
      if (state === 3) { this.fragmentCall(runtime, value, 'onStop'); this.notifyFragment(runtime, value, 'onFragmentStopped'); }
      if (state === 2 && fragment.root) { this.fragmentCall(runtime, value, 'onDestroyView'); this.notifyFragment(runtime, value, 'onFragmentViewDestroyed'); const parent = runtime.object(fragment.root).parent; if (parent) runtime.object(parent).children = runtime.object(parent).children.filter(ref => !sameRef(ref, fragment.root)); fragment.root = null; }
      if (state === 1) { if (!fragment.retaining) { this.fragmentCall(runtime, value, 'onDestroy'); this.notifyFragment(runtime, value, 'onFragmentDestroyed'); } this.fragmentCall(runtime, value, 'onDetach'); this.notifyFragment(runtime, value, 'onFragmentDetached'); }
      state = fragment.fragmentStage = state - 1;
    }
  }
  moveFragments(runtime, frame, target) {
    if (!frame.fragmentManager) return;
    const manager = runtime.object(frame.fragmentManager);
    for (const fragment of manager.fragments) this.moveFragment(runtime, fragment, target);
    manager.destroyed = target === 0;
  }
  /** The lifecycle stage a manager's fragments follow: that of the Activity that owns the manager (never a global "current" Activity). */
  hostStage(runtime, manager) { const host = manager.host; if (nullish(host)) return 0; return this.frame(runtime, host).lifecycleStage || 0; }
  fragmentRemove(runtime, manager, value, keep) {
    const fragment = runtime.object(value);
    if (!manager.fragments.some(ref => sameRef(ref, value))) return false;
    this.moveFragment(runtime, value, keep ? 1 : 0); manager.fragments = manager.fragments.filter(ref => !sameRef(ref, value)); fragment.added = false;
    if (keep) fragment.stashed = true; else { fragment.manager = null; fragment.stashed = false; }
    return true;
  }
  fragmentAdd(runtime, managerValue, manager, value, containerId, tag) {
    const fragment = runtime.object(value);
    if (fragment.manager && !fragment.stashed) runtime.throwJava('Ljava/lang/IllegalStateException;', `Fragment already added: ${runtime.typeOf(value).slice(1, -1).replaceAll('/', '.')}`);
    Object.assign(fragment, { manager: managerValue, host: manager.host, tag: tag ?? fragment.tag ?? null, containerId: containerId || fragment.containerId || 0, added: true, stashed: false, hidden: !!fragment.hidden, detached: false });
    if (!fragment.fragmentStage) fragment.fragmentStage = 0;
    manager.fragments.push(value); this.moveFragment(runtime, value, this.hostStage(runtime, manager));
  }
  fragmentSetHidden(runtime, value, hidden) {
    const fragment = runtime.object(value); if (!!fragment.hidden === hidden) return; fragment.hidden = hidden;
    if (!nullish(fragment.root)) runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setVisibility', signature: '(I)V', parameters: ['I'], result: 'V' }, [fragment.root, hidden ? 8 : 0], 'virtual');
    this.fragmentCall(runtime, value, 'onHiddenChanged', ['Z'], [hidden ? 1 : 0]);
  }
  executeTransactions(runtime, managerValue) {
    const manager = runtime.object(managerValue); let executed = false;
    if (manager.destroyed) { manager.pending.length = 0; return 0; }   // the owning Activity is gone: nothing left to run against (commit() on a destroyed manager already threw)
    while (manager.pending.length) {
      if (manager.pending[0].pop) { const action = manager.pending.shift().pop; this.popRecords(runtime, managerValue, action.name, action.id, action.flags); executed = true; continue; }
      const transaction = manager.pending.shift(), record = transaction.backStackName !== undefined ? { name: transaction.backStackName, id: transaction.id, undo: [] } : null;
      for (const operation of transaction.operations) {
        const fragment = runtime.object(operation.fragment);
        if (operation.kind === 'add') { this.fragmentAdd(runtime, managerValue, manager, operation.fragment, operation.containerId, operation.tag); record?.undo.push({ kind: 'remove-added', fragment: operation.fragment }); }
        else if (operation.kind === 'remove') { if (this.fragmentRemove(runtime, manager, operation.fragment, !!record)) record?.undo.push({ kind: 'readd', fragment: operation.fragment }); }
        else if (operation.kind === 'replace') {
          for (const existing of [...manager.fragments]) if (!sameRef(existing, operation.fragment) && (operation.containerId ? runtime.object(existing).containerId === operation.containerId : false)) { if (this.fragmentRemove(runtime, manager, existing, !!record)) record?.undo.push({ kind: 'readd', fragment: existing }); }
          this.fragmentAdd(runtime, managerValue, manager, operation.fragment, operation.containerId, operation.tag); record?.undo.push({ kind: 'remove-added', fragment: operation.fragment });
        }
        else if (operation.kind === 'hide' || operation.kind === 'show') { const hide = operation.kind === 'hide'; if (!!fragment.hidden !== hide) { this.fragmentSetHidden(runtime, operation.fragment, hide); record?.undo.push({ kind: hide ? 'show' : 'hide', fragment: operation.fragment }); } }
        else if (operation.kind === 'detach') { if (fragment.added && !fragment.detached) { this.moveFragment(runtime, operation.fragment, 1); fragment.detached = true; record?.undo.push({ kind: 'attach', fragment: operation.fragment }); } }
        else if (operation.kind === 'attach') { if (fragment.detached) { fragment.detached = false; this.moveFragment(runtime, operation.fragment, this.hostStage(runtime, manager)); record?.undo.push({ kind: 'detach', fragment: operation.fragment }); } }
      }
      if (record) (manager.backStack ??= []).push(record);
      executed = true;
    }
    return executed ? 1 : 0;
  }
  /** FragmentManager.popBackStack: undoes back-stack records from the top. With a name or id, down to the first record that matches (POP_BACK_STACK_INCLUSIVE = 1 pops it as well); returns whether anything was popped. */
  popRecords(runtime, managerValue, name, id, flags) {
    const manager = runtime.object(managerValue);
    const stack = manager.backStack ?? []; if (!stack.length) return 0;
    let keep = stack.length - 1;   // index of the last record that is popped
    let first = stack.length - 1;
    if (name === undefined && id === undefined) { first = stack.length - 1; keep = first; }
    else {
      let index = stack.length - 1; for (; index >= 0; index--) if ((name !== null && name !== undefined && stack[index].name === name) || (id !== undefined && id >= 0 && stack[index].id === id)) break;
      if (index < 0) return 0;
      keep = (flags & 1) ? index : index + 1; if (keep >= stack.length) return 0;
    }
    for (let at = stack.length - 1; at >= keep; at--) {
      const record = stack.pop();
      for (const step of [...record.undo].reverse()) {
        const fragment = runtime.object(step.fragment);
        if (step.kind === 'remove-added') this.fragmentRemove(runtime, manager, step.fragment, false);
        else if (step.kind === 'readd') { fragment.added = true; fragment.stashed = false; manager.fragments.push(step.fragment); this.moveFragment(runtime, step.fragment, this.hostStage(runtime, manager)); }
        else if (step.kind === 'hide' || step.kind === 'show') this.fragmentSetHidden(runtime, step.fragment, step.kind === 'hide');
        else if (step.kind === 'detach') { this.moveFragment(runtime, step.fragment, 1); fragment.detached = true; }
        else if (step.kind === 'attach') { fragment.detached = false; this.moveFragment(runtime, step.fragment, this.hostStage(runtime, manager)); }
      }
    }
    void first; return 1;
  }
  fragmentInvoke(runtime, method, args) {
    const owner = method.owner, name = method.name, value = args[0], object = runtime.object(value);
    if (owner === FRAGMENT_MANAGER) {
      if (name === 'findFragmentByTag') return [...object.fragments].reverse().find((ref) => runtime.object(ref).tag === args[1]) ?? null;
      if (name === 'beginTransaction') { const transaction = runtime.makeObject(TRANSACTION); Object.assign(runtime.object(transaction), { manager: value, operations: [], committed: false }); return transaction; }
      if (name === 'executePendingTransactions') return this.executeTransactions(runtime, value);
      if (name === 'isDestroyed') return object.destroyed ? 1 : 0;
      if (name === 'registerFragmentLifecycleCallbacks') { if (nullish(args[1])) error('FragmentLifecycleCallbacks must not be null'); (object.callbacks ??= []).push({ callbacks: args[1], recursive: !!args[2] }); return; }
      if (name === 'unregisterFragmentLifecycleCallbacks') { object.callbacks = (object.callbacks ?? []).filter(entry => !sameRef(entry.callbacks, args[1])); return; }
      if (name === 'findFragmentById') return [...object.fragments].reverse().find(ref => runtime.object(ref).containerId === args[1]) ?? null;
      if (name === 'getFragments') { const list = runtime.allocate('Ljava/util/ArrayList;'); runtime.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); for (const ref of object.fragments) runtime.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [list, ref], 'virtual'); return list; }
      if (name === 'getBackStackEntryCount') return (object.backStack ?? []).length;
      if (name.startsWith('popBackStack')) {
        const immediate = name === 'popBackStackImmediate', p = method.parameters;
        const action = p.length === 0 ? { name: undefined, id: undefined, flags: 0 } : p[0] === 'Ljava/lang/String;' ? { name: nullish(args[1]) ? null : runtime.stringCharacters(args[1]), id: undefined, flags: args[2] } : { name: undefined, id: args[1], flags: args[2] };
        if (object.destroyed) { if (immediate) runtime.throwJava('Ljava/lang/IllegalStateException;', 'Activity has been destroyed'); return; }
        object.pending.push({ pop: action });   // FragmentManager.enqueueAction: popBackStack() runs with the pending transactions, in order
        if (immediate) { const before = (object.backStack ?? []).length; this.executeTransactions(runtime, value); return (object.backStack ?? []).length < before ? 1 : 0; }
        this.queueTask(() => { if (object.pending.length) this.executeTransactions(runtime, value); }, 0, [value]); return;
      }
    }
    if (owner === TRANSACTION) {
      if (object.committed) error('FragmentTransaction is already committed');
      if (name === 'add' || name === 'remove' || name === 'replace' || name === 'hide' || name === 'show' || name === 'attach' || name === 'detach') {
        const p = method.parameters, withContainer = p[0] === 'I', fragment = withContainer ? args[2] : args[1], tag = withContainer ? (p[2] === 'Ljava/lang/String;' ? args[3] : null) : (p[1] === 'Ljava/lang/String;' ? args[2] : null);
        if (nullish(fragment)) runtime.throwJava('Ljava/lang/NullPointerException;', 'Fragment must not be null');
        object.operations.push({ kind: name, fragment, tag: nullishString(runtime, tag), containerId: withContainer ? args[1] : 0 }); return value;
      }
      if (name === 'addToBackStack') { if (object.backStackDisallowed) runtime.throwJava('Ljava/lang/IllegalStateException;', 'This FragmentTransaction is not allowed to be added to the back stack.'); object.backStackName = nullish(args[1]) ? null : runtime.stringCharacters(args[1]); return value; }
      if (name === 'disallowAddToBackStack') { if (object.backStackName !== undefined) runtime.throwJava('Ljava/lang/IllegalStateException;', 'This transaction is already being added to the back stack'); object.backStackDisallowed = true; return value; }
      if (name === 'isAddToBackStackAllowed') return object.backStackDisallowed ? 0 : 1;
      if (name === 'isEmpty') return object.operations.length === 0 ? 1 : 0;
      if (name === 'setCustomAnimations' || name === 'setTransition' || name === 'setReorderingAllowed') return value;   // animations and transition styles have no effect on the lab's lifecycle
      const manager = runtime.object(object.manager); if (manager.destroyed) runtime.throwJava('Ljava/lang/IllegalStateException;', 'Activity has been destroyed');
      object.committed = true; manager.pending.push(object); const id = object.id = ++this.transactionSequence;
      if (name.startsWith('commitNow')) { this.executeTransactions(runtime, object.manager); return; }
      this.queueTask(() => { if (manager.pending.length) this.executeTransactions(runtime, object.manager); }, 0, [object.manager]); return id;
    }
    if (name === '<init>') { object.fragmentStage = 0; object.added = false; return; }
    if (name === 'getView') return object.root ?? null;
    if (name === 'onCreateView') return null;
    if (name === 'getActivity' || name === 'getContext') return object.host ?? null;
    if (name === 'getFragmentManager') return object.manager ?? null;
    if (name === 'setArguments') { if (object.added) error('Cannot replace arguments after Fragment added'); object.arguments = args[1]; return; }
    if (name === 'getArguments') return object.arguments ?? null;
    if (name === 'setRetainInstance') { object.retained = !!args[1]; return; }
    if (name === 'getRetainInstance') return object.retained ? 1 : 0;
    if (name === 'isAdded') return object.added ? 1 : 0;
    if (name === 'getTag') return object.tag ?? null;
    if (name === 'getId') return object.containerId ?? 0;
    if (name === 'isHidden') return object.hidden ? 1 : 0;
    if (name === 'isDetached') return object.detached ? 1 : 0;
    if (name === 'isRemoving') return 0;
    if (name === 'isResumed') return object.fragmentStage === 4 ? 1 : 0;
    if (name === 'isVisible') return object.added && !nullish(object.host) && !object.hidden && !nullish(object.root) && !object.detached ? 1 : 0;
    if (name === 'getParentFragment') return null;
    if (name === 'getChildFragmentManager') error('Fragment.getChildFragmentManager: nested fragment managers are not part of the lab; use getFragmentManager()');
    if (name === 'getUserVisibleHint') return object.userVisibleHint === false ? 0 : 1;
    if (name === 'setUserVisibleHint') { object.userVisibleHint = !!args[1]; return; }
    if (name === 'setHasOptionsMenu') { object.hasOptionsMenu = !!args[1]; return; }
    if (name === 'getResources' || name === 'getString') {
      if (nullish(object.host)) runtime.throwJava('Ljava/lang/IllegalStateException;', `Fragment ${runtime.typeOf(value).slice(1, -1).replaceAll('/', '.')} not attached to Activity`);
      const parameters = name === 'getResources' ? [] : method.parameters, result = name === 'getResources' ? 'Landroid/content/res/Resources;' : 'Ljava/lang/String;';
      return runtime.dispatch({ owner: ACTIVITY, name, signature: `(${parameters.join('')})${result}`, parameters, result }, [object.host, ...args.slice(1)], 'virtual');
    }
    if (name === 'startActivity' || name === 'startActivityForResult') {
      if (nullish(object.host)) runtime.throwJava('Ljava/lang/IllegalStateException;', `Fragment ${runtime.typeOf(value).slice(1, -1).replaceAll('/', '.')} not attached to Activity`);
      const frame = this.frame(runtime, object.host);
      if (name === 'startActivityForResult' && args[2] >= 0) (frame.fragmentRequests ??= new Map()).set(args[2], value);
      return this.startActivity(runtime, args[1], name === 'startActivityForResult' && args[2] >= 0 ? object.host : null, name === 'startActivityForResult' ? args[2] : -1);
    }
    if (name === 'onDetach') { object.host = null; return; }
    if (name === 'onAttach' && method.parameters[0] === 'Landroid/content/Context;') return this.fragmentCall(runtime, value, 'onAttach', [ACTIVITY], [args[1]]);
    if (name.startsWith('on')) return; // Framework base Fragment lifecycle methods have no user callback body.
    error(`Unsupported framework Fragment operation ${name}`);
  }
  /** The host events and Handler messages in the main Looper's MessageQueue, in queue order (read-only views for diagnostics and the collector; see looper-host.js). */
  get eventQueue() { return this.vmRuntime ? this.looperHost.snapshot(this.vmRuntime) : []; }
  /** Removes the queued host events `matches(event)` accepts. */
  cancelEvents(runtime, matches) { this.looperHost.cancel(runtime, matches); }
  nextEventDelay(now = this.clock.now()) {
    let delay = this.looperHost.nextDelay(now);
    if (this.externalSources) for (const source of this.externalSources) { const external = source.delay(); if (external !== null && (delay === null || external < delay)) delay = external; }   // e.g. a network exchange that made progress
    return delay;
  }
  /** Registers a source of work that completes outside the VM (network I/O): `delay()` is 0 when it has progress to deliver, `pending()` counts exchanges still in flight. */
  addExternalSource(source) { (this.externalSources ??= new Set()).add(source); }
  /** What the pump is about to run, in words: for the busy watchdog and the reports. */
  describeEvent(runtime, event) {
    if (event.platformTask) return `tarefa do host ${event.platformTask.name || '(anônima)'}`;
    try { return `Handler ${String(runtime.typeOf(event.handler)).slice(1, -1).replaceAll('/', '.')}`; } catch { return 'mensagem do Handler'; }
  }
  drainEvents(runtime, { now = this.clock.now(), maxEvents = 32 } = {}) {
    if (!Number.isFinite(now) || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 256) error('Invalid bounded message queue drain');
    this.vmRuntime = runtime;
    if (now > this.clock.now()) this.clock.skip(now - this.clock.now() + 1e-6);   // a caller that names a later time (tests, tools) says that time has arrived: the Java queue reads the VM clock
    const looper = this.looperHost; looper.ensureMain(runtime); looper.flushDeferred(runtime);
    let processed = 0;
    maybeCollect(runtime);   // quiescent point between host events: reclaim unreachable Java objects when the heap is filling (every call under APKWEB_GC_AUDIT=1)
    if (this.externalSources) for (const source of this.externalSources) source.drained?.();
    // UI first (ViewRootImpl.scheduleTraversals posts a sync barrier and an asynchronous frame callback, so the traversal and the frame run before the ordinary messages queued ahead of them): a due layout
    // pass or Choreographer frame goes before any other due event, whatever order the queue holds them in.
    // The priority only applies once the main thread is behind (the head event is overdue by more than UI_FIRST_BEHIND_MS of virtual time -- a flood, not the ordinary jitter of a launch): in the normal flow due-time order is kept, so a launch does not lay out twice.
    const nextDue = () => looper.nextDue(runtime, now, UI_FIRST_BEHIND_MS);
    // Fair scheduling: every round runs the main Looper's due events first (bounded by host time once background work is waiting), then ONE bounded background slice of green threads (coroutine workers, executors:
    // 8 ms of host time, 2 ms until the first frame is committed), and repeats -- so a flood of background work makes steady progress without ever starving the main thread's traversal and frame.
    const firstFrameDone = (this.viewWindowHost?.frameState?.().framesRun ?? 1) > 0, sliceMs = firstFrameDone ? 8 : 2, MAIN_BUDGET_MS = 16;
    const drainStart = performance.now();
    // One main-thread event: the watchdog, the clock and the collector see it as they always did; the original Looper.loopOnce (or, for a UI event that jumps the queue, the Runnable itself) runs it.
    const runEvent = due => {
      const event = due.event, hostMark = runtime.hostAllocs.length;
      runtime.monitor.eventRan(event); runtime.monitor.mainEventBegin(this.describeEvent(runtime, event)); const frozen = event.windowFrameTime !== undefined ? this.clock.freeze() : false;   // a Choreographer frame callback runs at its vsync instant (see VMClock)
      try {
        runtime.steps = 0;
        runtime.hostRoots.push(event); const savedSafeDepth = runtime.gcSafeDepth; if (!event.platformTask) runtime.gcSafeDepth = 1;   // a Handler message is only referenced from here: root it, and allow safepoint collections inside it
        try { if (due.direct) looper.runDirect(runtime, event); else looper.loopOnce(runtime); }
        finally { runtime.gcSafeDepth = savedSafeDepth; runtime.hostRoots.pop(); }
      } finally { runtime.monitor.mainEventEnd(); if (frozen) this.clock.thaw(); if (runtime.hostAllocs.length > hostMark) runtime.releaseHostAllocs(hostMark); }   // what the event's host code allocated is not in flight any more (natives further out stay below the mark)
    };
    for (let round = 0, slices = 0; round < 64 && (round === 0 || performance.now() - drainStart < DRAIN_HOST_BUDGET_MS); round++) {   // one pump returns to its caller within ~DRAIN_HOST_BUDGET_MS of host time (the page, input and the next pump get their turn)
      let ran = 0; const roundStart = performance.now();
      for (let due; processed < maxEvents && (due = nextDue());) {
        if (runtime.monitor.active) runtime.monitor.tick();
        runtime.stressCollect();   // APKWEB_GC_STRESS: whatever the next task needs must be reachable now
        ran++; runEvent(due); processed++;
        if (performance.now() - roundStart > MAIN_BUDGET_MS && runtime.multiThreaded && runtime.scheduler.hasRunnable()) break;   // background work gets its turn between main-thread events
      }
      if (runtime.multiThreaded && slices < 64 && runtime.scheduler.hasRunnable()) { runtime.steps = 0; runtime.sliceDeadline = performance.now() + sliceMs; try { runtime.monitor.sliceRan(); runtime.runThreads(); } finally { runtime.sliceDeadline = 0; } processed++; slices++; ran++; }
      if (!ran) break;
    }
    // MessageQueue.next(): the thread that finished a message goes back to next(), which runs the IdleHandlers when nothing is due and then blocks (the call ends with a LooperYield).
    if (looper.armed && !this.runningIdle && !nextDue()) {
      this.runningIdle = true; const mark = runtime.hostAllocs.length; runtime.monitor.mainEventBegin('MessageQueue.next (IdleHandlers)');
      try { runtime.steps = 0; looper.loopOnce(runtime); } finally { runtime.monitor.mainEventEnd(); this.runningIdle = false; if (runtime.hostAllocs.length > mark) runtime.releaseHostAllocs(mark); }
    }
    const eventDelay = this.nextEventDelay(), threadDelay = runtime.scheduler.threadDelay();
    let waitingIO = 0; if (this.externalSources) for (const source of this.externalSources) waitingIO += source.pending?.() ?? 0;
    return { processed, pending: looper.count(runtime), waitingIO, nextDelay: eventDelay === null ? threadDelay : threadDelay === null ? eventDelay : Math.min(eventDelay, threadDelay) };
  }
  keyViewInvoke(runtime, method, args) {
    const object = runtime.object(args[0]), source = runtime.object(object.bundleSource), entries = source.extras, name = method.name;
    if (method.owner === KEY_SET) {
      if (name === 'size') return entries.size;
      if (name === 'isEmpty') return entries.size ? 0 : 1;
      if (name === 'contains') return typeof args[1] === 'string' && entries.has(args[1]) ? 1 : 0;
      if (name === 'remove') { const removed = entries.delete(args[1]); if (removed) source.bundleVersion = (source.bundleVersion || 0) + 1; return removed ? 1 : 0; }
      if (name === 'clear') { if (entries.size) source.bundleVersion = (source.bundleVersion || 0) + 1; entries.clear(); return; }
      if (name === 'iterator') { const value = runtime.makeObject(KEY_ITERATOR), iterator = runtime.object(value); Object.assign(iterator, { bundleSource: object.bundleSource, keys: [...entries.keys()], index: 0, last: null, expectedVersion: source.bundleVersion || 0 }); return value; }
    } else {
      if ((source.bundleVersion || 0) !== object.expectedVersion) error('ConcurrentModificationException in Bundle.keySet iterator');
      if (name === 'hasNext') return object.index < object.keys.length ? 1 : 0;
      if (name === 'next') { if (object.index >= object.keys.length) error('NoSuchElementException in Bundle.keySet iterator'); object.last = object.keys[object.index++]; return object.last; }
      if (name === 'remove') { if (object.last === null) error('IllegalStateException in Bundle.keySet iterator.remove'); entries.delete(object.last); source.bundleVersion = (source.bundleVersion || 0) + 1; object.expectedVersion = source.bundleVersion; object.last = null; return; }
    }
    error(`Unsupported Bundle key view ${name}`);
  }
  intentInvoke(runtime, method, args) {
    const value = args[0], intent = runtime.object(value), name = method.name;
    if (name === '<init>') {
      intent.extras = new Map(); intent.flags = 0; intent.action = null; intent.target = null; intent.data = null; intent.mimeType = null;
      if (method.parameters[0] === INTENT) { const source = runtime.object(args[1]); Object.assign(intent, { extras: new Map(source.extras || []), extrasPresent: !!source.extrasPresent || !!source.extras?.size, extrasClassLoader: source.extrasClassLoader ?? null, flags: source.flags || 0, action: source.action, target: source.target, data: source.data ?? null, mimeType: source.mimeType ?? null, component: source.component ?? null, identifier: source.identifier ?? null, package: source.package ?? null, categories: source.categories ? [...source.categories] : undefined, clipData: source.clipData ?? null }); }
      else if (method.parameters[1] === 'Landroid/net/Uri;') { intent.action = checkString(args[1], 'Intent action'); if (args[2] && !runtime.isSubtype(runtime.object(args[2]).type, 'Landroid/net/Uri;')) error('Intent data must be a Uri'); intent.data = args[2]; }
      else if (method.parameters.length === 2) intent.target = runtime.object(args[2]).classType;
      else if (method.parameters[0] === 'Ljava/lang/String;') intent.action = checkString(args[1], 'Intent action');
      return;
    }
    if (name === 'setExtrasClassLoader') { if (intent.extrasPresent || intent.extras?.size) intent.extrasClassLoader = args[1]; return; }
    if (name === 'getData') return intent.data ?? null;
    if (name === 'getDataString') return intent.data ? runtime.dispatch({ owner: 'Landroid/net/Uri;', name: 'toString', signature: '()Ljava/lang/String;', parameters: [], result: 'Ljava/lang/String;' }, [intent.data], 'virtual') : null;
    if (name === 'getType') return intent.mimeType ?? null;
    if (name === 'setType') { intent.mimeType = args[1]; intent.data = null; return value; }
    if (name === 'setData' || name === 'setDataAndType') { if (args[1] && !runtime.isSubtype(runtime.object(args[1]).type, 'Landroid/net/Uri;')) error('Intent data must be a Uri'); intent.data = args[1] || null; intent.mimeType = name === 'setDataAndType' ? args[2] : null; return value; }
    if (name === 'setClass') { intent.target = runtime.object(args[2]).classType; intent.component = null; return value; }
    if (name === 'setClassName') { const className = checkString(args[2], 'Intent class name'); const packageName = typeof args[1] === 'string' ? args[1] : this.resources?.table?.packages?.[0]?.name || runtime.activityType.slice(1, -1).split('/').slice(0, -1).join('.'); intent.target = descriptor(className.startsWith('.') ? packageName + className : className.includes('.') ? className : `${packageName}.${className}`); return value; }
    if (name === 'setComponent') { intent.component = args[1] ?? null; if (args[1]) { const className = runtime.object(args[1]).className; if (typeof className === 'string' && runtime.classes.has(descriptor(className))) intent.target = descriptor(className); } return value; }
    if (name === 'getComponent') {
      // Intent(Context, Class) / setClass / setClassName set mComponent = new ComponentName(package, class) on Android.
      if (!intent.component && intent.target) {
        const component = runtime.allocate('Landroid/content/ComponentName;');
        runtime.dispatch({ owner: 'Landroid/content/ComponentName;', name: '<init>', parameters: ['Ljava/lang/String;', 'Ljava/lang/String;'], result: 'V', signature: '(Ljava/lang/String;Ljava/lang/String;)V' }, [component, this.packageName, intent.target.slice(1, -1).replaceAll('/', '.')], 'direct');
        intent.component = component;
      }
      return intent.component ?? null;
    }
    if (name === 'setPackage') { intent.package = args[1] ?? null; return value; }
    if (name === 'getPackage') return intent.package ?? null;
    if (name === 'addCategory') { (intent.categories ??= []).includes(args[1]) || intent.categories.push(args[1]); return value; }
    if (name === 'hasCategory') return intent.categories?.includes(args[1]) ? 1 : 0;
    if (name === 'getCategories') { if (!intent.categories?.length) return null; const set = runtime.allocate('Ljava/util/HashSet;'); runtime.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct'); for (const category of intent.categories) runtime.dispatch({ owner: 'Ljava/util/HashSet;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [set, category], 'virtual'); return set; }
    if (name === 'resolveTypeIfNeeded') return intent.mimeType ?? null;   // Intent.resolveTypeIfNeeded: the explicit type (a content: URI's provider type would need ContentResolver.getType)
    if (name === 'removeCategory') { intent.categories = (intent.categories ?? []).filter(item => item !== args[1]); return; }
    if (name === 'getScheme') { const uri = intent.data ? runtime.dispatch({ owner: 'Landroid/net/Uri;', name: 'getScheme', signature: '()Ljava/lang/String;', parameters: [], result: 'Ljava/lang/String;' }, [intent.data], 'virtual') : null; return uri; }
    if (name === 'setAction') { intent.action = args[1]; return value; }
    if (name === 'getAction') return intent.action ?? null;
    if (name === 'getFlags') return intent.flags || 0;
    if (name === 'setFlags') { intent.flags = args[1] | 0; return value; }
    if (name === 'addFlags') { intent.flags = (intent.flags || 0) | args[1]; return value; }
    if (name === 'hasExtra') return this.extras(runtime, value).has(checkString(args[1], 'Intent key')) ? 1 : 0;
    if (name === 'removeExtra') { this.extras(runtime, value).delete(checkString(args[1], 'Intent key')); return; }
    if (name === 'getExtras') return intent.extrasPresent || this.extras(runtime, value).size ? this.bundle(runtime, this.extras(runtime, value), intent.extrasClassLoader ?? null) : null;
    if (name === 'putExtras' || name === 'replaceExtras') {
      if (name === 'replaceExtras') { intent.extras = new Map(); intent.extrasPresent = false; intent.extrasClassLoader = null; }
      if (!nullish(args[1])) { if (!intent.extrasPresent) intent.extrasClassLoader = runtime.object(args[1]).classLoader ?? null; intent.extrasPresent = true; for (const [key, entry] of this.extras(runtime, args[1])) this.put(runtime, value, key, entry.type, entry.value); }
      return value;
    }
    if (name === 'putExtra') { this.put(runtime, value, args[1], method.parameters[1], args[2]); return value; }
    if (name.startsWith('get') && name.endsWith('Extra') && method.parameters[1] === 'Ljava/lang/Class;') return this.typedValue(runtime, value, name.slice(0, -'Extra'.length), args[1], args[2]);   // API 33 typed getters: Intent.getXExtra(name, Class) is mExtras.getX(name, Class)
    if (name.startsWith('get') && name.endsWith('Extra')) { const fallback = args.length > 2 ? args[2] : null; return this.get(runtime, value, args[1], method.result, fallback); }
    error(`Unsupported Intent operation ${name}`);
  }
}
