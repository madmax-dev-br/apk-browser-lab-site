import { APP_PID, ZYGOTE_PID } from './virtual-pids.js?v=c542646b3fce';
import { createPackageRegistry } from './package-registry.js?v=c542646b3fce';
import { describeMicrogEntryPoints, describeMicrogStubs, describeMicrogServices } from './microg-device.js?v=c542646b3fce';
import { hostDefinitions } from './host-contract.js?v=c542646b3fce';
import { Invoke } from './interpreter.js?v=c542646b3fce';
import { PACKAGE_VALUE_PARENTS } from './package-value-fields.js?v=c542646b3fce';
import { createComposeCanvasHost } from './compose-canvas-host.js?v=c542646b3fce';
import { createViewTransformHost } from './view-transform-host.js?v=c542646b3fce';
import { createViewPropertyAnimatorHost } from './view-property-animator-host.js?v=c542646b3fce';
import { createViewOutlineHost } from './view-outline-host.js?v=c542646b3fce';
import { createShaderHost } from './shader-host.js?v=c542646b3fce';
import { createSystemBarsHost } from './system-bars-host.js?v=c542646b3fce';
import { createDeviceStateHost } from './device-state-host.js?v=c542646b3fce';
import { createJobSchedulerHost } from './job-scheduler-host.js?v=c542646b3fce';
import { createPendingIntentHost } from './pending-intent-host.js?v=c542646b3fce';
import { createTelephonySms } from './telephony-sms.js?v=c542646b3fce';
import { ActivityStarter, activityInfoOf, FLAG as LAUNCH_FLAG } from './activity-starter.js?v=c542646b3fce';
import { ignoreActivityStart } from './ignored-activities.js?v=c542646b3fce';
import { resolveIntentFields } from './intent-resolver.js?v=c542646b3fce';
import { createBinderHost } from './binder-host.js?v=c542646b3fce';
import { createInputManagerHost } from './input-native.js?v=c542646b3fce';
import { createBackDispatcherHost } from './back-dispatcher-host.js?v=c542646b3fce';
import { createRenderThreadAnimators } from './rt-animators.js?v=c542646b3fce';
import { renderNodeByHandle } from './rendernode-native.js?v=c542646b3fce';
import { resolveDevice } from './device-profile.js?v=c542646b3fce';
import { configurationFor } from './device-configuration.js?v=c542646b3fce';
import { createViewCoordinateHost } from './view-coordinate-host.js?v=c542646b3fce';
import { createEditableTextHost } from './editable-text-host.js?v=c542646b3fce';
import { createComponentCallbacksHost } from './component-callbacks-host.js?v=c542646b3fce';
import { createViewStateHost } from './view-state-host.js?v=c542646b3fce';
import { createLocaleServiceHost } from './locale-service-host.js?v=c542646b3fce';
import { APKError, dottedName } from './apk-runtime.js?v=c542646b3fce';
import { HOST_STYLEABLES, LAYOUTS_PROFILE_ATTRIBUTES, ANDROID_13_LAST_ATTRIBUTE_ID } from './host-styleables.js?v=c542646b3fce';
import { ORIGINAL_ATTRIBUTES_WITHOUT_PAGE_EFFECT } from './original-attribute-page-gaps.js?v=c542646b3fce';
export { ORIGINAL_ATTRIBUTES_WITHOUT_PAGE_EFFECT };
import { AndroidXmlHost, XML_METHODS } from './android-xml-host.js?v=c542646b3fce';
import { createViewTreeHost } from './view-tree-host.js?v=c542646b3fce';
import { createDialogWindowHost } from './dialog-window-host.js?v=c542646b3fce';
import { createStrictModeHost } from './strictmode-host.js?v=c542646b3fce';
import { createVmDebugHost } from './vm-debug-host.js?v=c542646b3fce';
import { createProgressBarApiHost } from './progress-bar-api-host.js?v=c542646b3fce';
import { createViewGroupApiHost } from './viewgroup-api-host.js?v=c542646b3fce';
import { createViewInternalsHost } from './view-internals-host.js?v=c542646b3fce';
import { createWindowManagerGlobal } from './window-manager-global.js?v=c542646b3fce';
import { createViewWindowHost } from './view-window-host.js?v=c542646b3fce';
import { createVectorCanvasHost } from './vector-native.js?v=c542646b3fce';
import { createPaintHost, BLUR_STYLE, BLUR_STYLE_NAMES } from './paint-host.js?v=c542646b3fce';
import { createContentResolverHost } from './content-resolver-host.js?v=c542646b3fce';
import { createDrawableViewHost } from './drawable-view-host.js?v=c542646b3fce';
import { createDeviceServicesHost } from './device-services-host.js?v=c542646b3fce';
import { createSystemServicesHost } from './system-services-host.js?v=c542646b3fce';
import { createJavaIoHost } from './java-io-host.js?v=c542646b3fce';
import { createClassLoaderHost } from './class-loader-host.js?v=c542646b3fce';
import { createAppServicesHost } from './app-services-host.js?v=c542646b3fce';
import { createConcurrencyHost } from './concurrency-host.js?v=c542646b3fce';
import { createMethodHandlesHost } from './method-handles.js?v=c542646b3fce';
import { createLooperHost } from './looper-host.js?v=c542646b3fce';
import { createDateTimeHost } from './datetime-host.js?v=c542646b3fce';
const LOCALE_CONSTANTS = { US: 'en-US', UK: 'en-GB', ENGLISH: 'en', ROOT: 'und', CANADA: 'en-CA', CANADA_FRENCH: 'fr-CA', FRANCE: 'fr-FR', FRENCH: 'fr', GERMAN: 'de', GERMANY: 'de-DE', ITALIAN: 'it', ITALY: 'it-IT', JAPAN: 'ja-JP', JAPANESE: 'ja', KOREA: 'ko-KR', KOREAN: 'ko', CHINA: 'zh-CN', CHINESE: 'zh', PRC: 'zh-CN', SIMPLIFIED_CHINESE: 'zh-CN', TAIWAN: 'zh-TW', TRADITIONAL_CHINESE: 'zh-TW' };
import { createNumberFormatHost } from './number-format-host.js?v=c542646b3fce';
import { createCookieHost } from './cookie-host.js?v=c542646b3fce';
import { createViewApiHost } from './view-api-host.js?v=c542646b3fce';
import { createActionModeHost } from './action-mode-host.js?v=c542646b3fce';
import { createTextViewApiHost } from './textview-api-host.js?v=c542646b3fce';
import { createIntentApiHost } from './intent-api-host.js?v=c542646b3fce';
import { createImageDecoderHost } from './image-decoder-host.js?v=c542646b3fce';
import { createAnimatedImageHost } from './animated-image-host.js?v=c542646b3fce';
import { createPlatformDataClassesHost } from './platform-data-classes-host.js?v=c542646b3fce';
import { createToastHost } from './toast-host.js?v=c542646b3fce';
import { createIcuTextHost } from './icu-text-host.js?v=c542646b3fce';
import { createMiscPlatformHost } from './misc-platform-host.js?v=c542646b3fce';
import { createRemoteViewsHost } from './remote-views-host.js?v=c542646b3fce';
import { createPackageManagerApiHost } from './package-manager-api-host.js?v=c542646b3fce';
import { createPackageValueObjectsHost } from './package-value-objects.js?v=c542646b3fce';
import { createNetworkInfoHost } from './network-info-host.js?v=c542646b3fce';
import { createApkChecksumsHost } from './apk-checksums-host.js?v=c542646b3fce';
import { createContentResolverApiHost } from './content-resolver-api-host.js?v=c542646b3fce';
import { createActivityApiHost, forcedOrientationOf, orientationLockOf } from './activity-api-host.js?v=c542646b3fce';
import { createImageViewApiHost } from './image-view-api-host.js?v=c542646b3fce';
import { createUriApiHost } from './uri-api-host.js?v=c542646b3fce';
import { createFormatterHost } from './formatter-host.js?v=c542646b3fce';
import { createJcaHost } from './jca-host.js?v=c542646b3fce';
import { createCompatCallbacksHost } from './compat-callbacks-host.js?v=c542646b3fce';
import { createIcuBidiHost } from './icu-bidi-host.js?v=c542646b3fce';
import { createSecurityHost } from './security-host.js?v=c542646b3fce';
import { createReflectionHost } from './reflection-host.js?v=c542646b3fce';
import { createSerializationHost } from './serialization-host.js?v=c542646b3fce';
import { createBitmapCodecHost } from './bitmap-codec-host.js?v=c542646b3fce';
import { createBitmapDrawableHost } from './bitmap-drawable-host.js?v=c542646b3fce';
import { createImageViewHost } from './image-view-host.js?v=c542646b3fce';
import { createWebViewHost } from './webview-host.js?v=c542646b3fce';
import { createContentExtrasHost } from './content-extras-host.js?v=c542646b3fce';
import { createPreferenceManagerHost } from './preference-manager-host.js?v=c542646b3fce';
import { createProcessHost } from './process-host.js?v=c542646b3fce';
import { createStatsHost } from './stats-host.js?v=c542646b3fce';
import { createTelephonyHost } from './telephony-host.js?v=c542646b3fce';
import { createSurfaceTextureHost } from './surface-texture-host.js?v=c542646b3fce';
import { createCameraHost } from './camera-host.js?v=c542646b3fce';
import { createScaleGestureHost } from './scale-gesture-host.js?v=c542646b3fce';
import { createBuildHost } from './build-host.js?v=c542646b3fce';
import { createSensorHost } from './sensor-host.js?v=c542646b3fce';
import { createGeocoderHost } from './geocoder-host.js?v=c542646b3fce';
import { createCoreLangHost } from './core-lang-host.js?v=c542646b3fce';
import { createResourcesExtrasHost } from './resources-extras-host.js?v=c542646b3fce';
import { createSimpleTimeZoneHost } from './simple-timezone-host.js?v=c542646b3fce';
import { createActivityManagerExtrasHost } from './activity-manager-extras-host.js?v=c542646b3fce';
import { createManagersExtrasHost } from './managers-extras-host.js?v=c542646b3fce';
import { createAccountSessionsHost } from './account-sessions.js?v=c542646b3fce';
import { createStrictMathHost } from './strict-math-host.js?v=c542646b3fce';
import { createLocaleExtrasHost } from './locale-extras-host.js?v=c542646b3fce';
import { createUnicodeHost } from './unicode-host.js?v=c542646b3fce';
import { createMessageFormatHost } from './message-format-host.js?v=c542646b3fce';
import { createSettingsHost } from './settings-host.js?v=c542646b3fce';
import { createHardwareServicesHost } from './hardware-services-host.js?v=c542646b3fce';
import { createPermissionHost } from './permission-host.js?v=c542646b3fce';
import { createPeripheralServicesHost } from './peripheral-services-host.js?v=c542646b3fce';
import { createStorageServicesHost } from './storage-services-host.js?v=c542646b3fce';
import { createSharedStorageHost } from './shared-storage-host.js?v=c542646b3fce';
import { createSystemManagersHost } from './system-managers-host.js?v=c542646b3fce';
import { createJavaServicesHost } from './java-services-host.js?v=c542646b3fce';
import { DEVICE_FEATURES } from './service-kit.js?v=c542646b3fce';
import { createTypefaceBuilderHost } from './typeface-builder-host.js?v=c542646b3fce';
import { createViewTouchHost } from './view-touch-host.js?v=c542646b3fce';
import { createMagnifierHost } from './magnifier-host.js?v=c542646b3fce';
import { createDisplayHost } from './display-host.js?v=c542646b3fce';
import { createNotificationHost } from './notification-host.js?v=c542646b3fce';
import { createDatabaseSupportHost } from './database-support-host.js?v=c542646b3fce';
import { VMClock } from './vm-clock.js?v=c542646b3fce';
import { createWindowInsetsHost } from './window-insets-host.js?v=c542646b3fce';
import { createAccessibilityServiceHost } from './accessibility-service-host.js?v=c542646b3fce';
import { createViewLayoutHost } from './view-layout-host.js?v=c542646b3fce';
import { createInputMethodServiceHost } from './input-method-service-host.js?v=c542646b3fce';
import { createAutofillServiceHost } from './autofill-service-host.js?v=c542646b3fce';
import { createClipboardServiceHost } from './clipboard-service-host.js?v=c542646b3fce';
import { createViewInputHost } from './view-input-host.js?v=c542646b3fce';
import { AndroidStyleBackend, STYLE_METHODS } from './android-style-backend.js?v=c542646b3fce';
import { WEB_DEVICE_CONFIGURATION } from './resource-config-provider.js?v=c542646b3fce';
import { maybeCollect, ephemeronMap } from './heap-gc.js?v=c542646b3fce';
import { BackgroundFloor, BACKGROUND_FLOOR_SLICE_MAX_MS } from './background-floor.js?v=c542646b3fce';
import { SYSTEM_PACKAGE, systemActivityDeclaration, resolvedSystemDeclaration, systemActivityNames } from './system-activities.js?v=c542646b3fce';

const ACTIVITY = 'Landroid/app/Activity;', INTENT = 'Landroid/content/Intent;', BUNDLE = 'Landroid/os/Bundle;';
const APPLICATION = 'Landroid/app/Application;', APP_CONTEXT = 'Landroid/app/ContextImpl;';
const STOP_IDLE_TIMEOUT_MS = 10000;   // ActivityTaskSupervisor IDLE_TIMEOUT: a finished Activity is stopped by then even if the next one never goes idle
const CONTEXTS = [ACTIVITY, APPLICATION, APP_CONTEXT, 'Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;'];
const KEYS = new Set();
let hostedIndex = null;   // AndroidPlatform.hostedResults: owner->name(params) -> result types of the served keys
const UI_FIRST_BEHIND_MS = 2000, DRAIN_HOST_BUDGET_MS = 30;
// drainEvents' next main-thread "event" when the main thread's suspended event can go on (vmcore/js/host-bridge.js suspendable): the pump resumes it, named for the watchdog and the reports.
const RESUME_SUSPENDED = Object.freeze({ event: Object.freeze({ platformTask: function resumeSuspendedEvent() {}, suspendedResume: true }), direct: true });
// Main thread first while the screen moves (Android gives the UI thread priority over background pools): while a Choreographer frame is pending or running, or an input arrived in the
// last GC_INPUT_SETTLE_MS (mainThreadMotion), a background slice is MOTION_SLICE_MS and background work gets at most MOTION_BACKGROUND_BUDGET_MS per pump, so the pump returns and the next
// frame runs at its vsync; with the screen still the slices are 8 ms and the pump's whole budget is available, so background work catches up between interactions.
const MOTION_SLICE_MS = 2, MOTION_BACKGROUND_BUDGET_MS = 4;
// Parallel credit (drainEvents): after a background slice overran by more than MIN, the other runnable threads get up to MAX of processor before the next main-thread event.
const PARALLEL_CREDIT_MIN_MS = 50, PARALLEL_CREDIT_MAX_MS = 250;
// Input counts as motion for this long (host time) after the last input delivered (click, pointer sample, typed text, scroll, semantics action): a drag or a typing burst arrives as a stream of
// page requests 16-50 ms apart, so a collector pause between two of them would be felt as a hitch; a 100 ms silence means the finger stopped (see mainThreadMotion, heap-gc.js deferral).
const GC_INPUT_SETTLE_MS = 100;
// The display's vsync interval (view-window-host.js frameInterval: 60 Hz) and the index of the interval a clock time falls in; a vsync time itself (k * interval, which
// floating point may land a hair below) belongs to interval k.
const VSYNC_MS = 1000 / 60, vsyncIndex = ms => Math.floor(ms / VSYNC_MS + 1e-6);
// An interaction: inputs closer than INTERACTION_GAP_MS to each other (a tap's down and up, a drag, a typing burst) and what the VM does until INTERACTION_TAIL_MS after the last one.
// What each interaction cost is kept for the diagnostics (interactionStats).
// The window also stays open while the main thread keeps working (events less than INTERACTION_GAP_MS apart), and until the screen is ready again after the input (noteSettled),
// up to INTERACTION_MAX_MS from the first input: a first navigation in a large app can run, or wait for the network, for many seconds after the tap, and closing at the tail cut
// off exactly the part that was slow.
const INTERACTION_GAP_MS = 1000, INTERACTION_TAIL_MS = 5000, INTERACTION_MAX_MS = 60000, INTERACTION_KEYS = 12;
const FRAGMENT_CALLBACKS = 'Landroid/app/FragmentManager$FragmentLifecycleCallbacks;', FRAGMENT = 'Landroid/app/Fragment;', FRAGMENT_MANAGER = 'Landroid/app/FragmentManager;', TRANSACTION = 'Landroid/app/FragmentTransaction;';
const LOCALE = 'Ljava/util/Locale;', LOCALES = 'Landroid/os/LocaleList;';
const PACKAGE_MANAGER = 'Landroid/content/pm/PackageManager;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;', ACTIVITY_INFO = 'Landroid/content/pm/ActivityInfo;', COMPONENT = 'Landroid/content/ComponentName;';
const CONFIGURATION = 'Landroid/content/res/Configuration;', METRICS = 'Landroid/util/DisplayMetrics;';
const INFLATER = 'Landroid/view/LayoutInflater;', ATTRIBUTES = 'Lapkweb/bridge/AttributeSet;';
const WINDOW = 'Landroid/view/Window;', PORTER_MODE = 'Landroid/graphics/PorterDuff$Mode;';
// AndroidPlatform.invoke's dispatch chain after the contract hosts, in its order: each entry says whether its host claims a key (a fixed key set) and serves the call, or answers
// CHAIN_NEXT to let the next claiming host have it (the dialog window host serves only the calls on its own windows).
const CHAIN_NEXT = Symbol('next host of the chain'), NO_ROUTE = Object.freeze([]);
const chainEntry = (field, serve = function (runtime, method, args) { return this[field].invoke(runtime, method, args); }) => Object.assign(serve, { claims: (platform, key) => platform[field].supports(key) });
const CHAIN_HOSTS = [
  chainEntry('systemBarsHost', function (runtime, method, args) {
    const name = method.name, receiver = args[0];
    if (method.owner === WINDOW && runtime.object(receiver).webPhoneWindow) { if (name === 'getInsetsController') return this.systemBarsHost.windowController(runtime, receiver); return /^get/.test(name) ? (name.startsWith('is') ? 0 : 0) : undefined; }
    return this.systemBarsHost.invoke(runtime, method, args);
  }),
  chainEntry('dialogWindowHost', function (runtime, method, args) { return this.dialogWindowHost.handles(runtime, method, args) ? this.dialogWindowHost.invoke(runtime, method, args) : CHAIN_NEXT; }),
  ...['viewOutlineHost', 'composeCanvasHost', 'viewTransformHost', 'viewPropertyAnimatorHost', 'viewCoordinateHost', 'editableTextHost', 'componentCallbacksHost', 'viewStateHost', 'localeService',
    'viewWindowHost', 'canvasHost', 'paintHost', 'contentHost', 'drawableViewHost', 'deviceServices', 'insetsHost', 'accessibilityService', 'viewLayoutHost', 'inputMethodService',
    'autofillService', 'clipboardService', 'viewInputHost'].map(field => chainEntry(field)),
  Object.assign(function (runtime, method, args) { return this.xmlHost.invoke(runtime, method, args); }, { claims: (platform, key) => XML_METHODS.has(key) }),
  chainEntry('viewTreeHost'),
  Object.assign(function (runtime, method, args) { return this.styleBackend.invoke(runtime, method, args); }, { claims: (platform, key) => STYLE_METHODS.has(key) }),
];
const LAYOUT_PARAMS = 'Landroid/view/ViewGroup$LayoutParams;', MARGIN_PARAMS = 'Landroid/view/ViewGroup$MarginLayoutParams;', RELATIVE_PARAMS = 'Landroid/widget/RelativeLayout$LayoutParams;';
/** Whether a LayoutParams class (below ViewGroup.LayoutParams / MarginLayoutParams) has its own resolveLayoutDirection(int) in loaded DEX. */
function overridesResolveLayoutDirection(runtime, type) {
  const seen = new Set();
  for (let t = type; t && t !== MARGIN_PARAMS && t !== LAYOUT_PARAMS && t !== 'Ljava/lang/Object;' && !seen.has(t); t = runtime.parent(t)) { seen.add(t); if (runtime.classes.get(t)?.methods.has('resolveLayoutDirection(I)V')) return true; }
  return false;
}
const RTL_NEEDS_PROFILE = 'right-to-left layout by the host FrameLayout / LinearLayout: a View resolved to right-to-left (its own direction, padding and margins follow), but mirroring the children of a container needs the original FrameLayout / LinearLayout of the layouts profile; the host containers loaded for this APK place them left-to-right';
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
add('Landroid/content/res/Resources;', ['getFraction(III)F', 'getString(I)Ljava/lang/String;', 'getText(I)Ljava/lang/CharSequence;', 'getInteger(I)I', 'getBoolean(I)Z', 'getColor(I)I', 'getColor(ILandroid/content/res/Resources$Theme;)I', 'getDimension(I)F', 'getDimensionPixelSize(I)I', 'getDimensionPixelOffset(I)I', 'getResourcePackageName(I)Ljava/lang/String;', 'getIdentifier(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)I', 'getResourceName(I)Ljava/lang/String;', 'getResourceEntryName(I)Ljava/lang/String;', 'getResourceTypeName(I)Ljava/lang/String;', 'getStringArray(I)[Ljava/lang/String;', 'getTextArray(I)[Ljava/lang/CharSequence;', 'getIntArray(I)[I']);
add(INTENT, ['setExtrasClassLoader(Ljava/lang/ClassLoader;)V', 'setComponent(Landroid/content/ComponentName;)Landroid/content/Intent;', 'getComponent()Landroid/content/ComponentName;', 'setPackage(Ljava/lang/String;)Landroid/content/Intent;', 'getPackage()Ljava/lang/String;', 'addCategory(Ljava/lang/String;)Landroid/content/Intent;', 'hasCategory(Ljava/lang/String;)Z', 'removeCategory(Ljava/lang/String;)V', 'getScheme()Ljava/lang/String;']);
add(INTENT, ['getCategories()Ljava/util/Set;', 'resolveTypeIfNeeded(Landroid/content/ContentResolver;)Ljava/lang/String;', 'getData()Landroid/net/Uri;', 'getDataString()Ljava/lang/String;', 'setData(Landroid/net/Uri;)Landroid/content/Intent;', 'setDataAndType(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;', 'getType()Ljava/lang/String;', 'setType(Ljava/lang/String;)Landroid/content/Intent;', '<init>(Ljava/lang/String;Landroid/net/Uri;)V', '<init>()V', '<init>(Landroid/content/Context;Ljava/lang/Class;)V', '<init>(Ljava/lang/String;)V', '<init>(Landroid/content/Intent;)V', 'setClass(Landroid/content/Context;Ljava/lang/Class;)Landroid/content/Intent;', 'setClassName(Landroid/content/Context;Ljava/lang/String;)Landroid/content/Intent;', 'setClassName(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;', 'getAction()Ljava/lang/String;', 'setAction(Ljava/lang/String;)Landroid/content/Intent;', 'getFlags()I', 'setFlags(I)Landroid/content/Intent;', 'addFlags(I)Landroid/content/Intent;', 'hasExtra(Ljava/lang/String;)Z', 'removeExtra(Ljava/lang/String;)V', 'getExtras()Landroid/os/Bundle;', 'putExtras(Landroid/os/Bundle;)Landroid/content/Intent;', 'replaceExtras(Landroid/os/Bundle;)Landroid/content/Intent;']);
add(PROCESS_INFO, ['<init>()V', '<init>(Ljava/lang/String;I[Ljava/lang/String;)V']);
add('Landroid/app/ActivityManager;', ['getMyMemoryState(Landroid/app/ActivityManager$RunningAppProcessInfo;)V']);
add(ACTIVITY, ['getLocalClassName()Ljava/lang/String;', 'getComponentName()Landroid/content/ComponentName;', 'getLayoutInflater()Landroid/view/LayoutInflater;']);
for (const owner of ['Landroid/view/View;', 'Landroid/view/ViewGroup;', ...['LinearLayout', 'FrameLayout', 'ScrollView', 'TextView', 'Button', 'EditText', 'CompoundButton', 'CheckBox', 'Switch', 'ProgressBar'].map(name => `Landroid/widget/${name};`)]) add(owner, ['<init>(Landroid/content/Context;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;I)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;II)V']);
add('Landroid/content/res/Resources;', ['getConfiguration()Landroid/content/res/Configuration;', 'getDisplayMetrics()Landroid/util/DisplayMetrics;', 'updateConfiguration(Landroid/content/res/Configuration;Landroid/util/DisplayMetrics;)V']);
add(PACKAGE_MANAGER, ['<init>()V', 'getServiceInfo(Landroid/content/ComponentName;I)Landroid/content/pm/ServiceInfo;', 'getActivityInfo(Landroid/content/ComponentName;I)Landroid/content/pm/ActivityInfo;', 'getApplicationInfo(Ljava/lang/String;I)Landroid/content/pm/ApplicationInfo;', 'hasSystemFeature(Ljava/lang/String;)Z', 'hasSystemFeature(Ljava/lang/String;I)Z']);
add(COMPONENT, ['<init>(Landroid/content/Context;Ljava/lang/Class;)V', '<init>(Landroid/content/Context;Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;)V', 'getClassName()Ljava/lang/String;', 'getPackageName()Ljava/lang/String;', 'flattenToString()Ljava/lang/String;', 'flattenToShortString()Ljava/lang/String;']);
add('Landroid/view/ViewGroup;', ['onViewAdded(Landroid/view/View;)V', 'onViewRemoved(Landroid/view/View;)V', 'generateDefaultLayoutParams()Landroid/view/ViewGroup$LayoutParams;', 'generateLayoutParams(Landroid/util/AttributeSet;)Landroid/view/ViewGroup$LayoutParams;']);
add('Landroid/view/View;', ['onFinishInflate()V']);
add('Landroid/view/ViewGroup;', ['setClipChildren(Z)V', 'getClipChildren()Z', 'setClipToPadding(Z)V', 'getClipToPadding()Z']);
add('Landroid/view/View;', ['setWillNotDraw(Z)V', 'willNotDraw()Z', 'getParent()Landroid/view/ViewParent;', 'setImportantForAccessibility(I)V', 'getImportantForAccessibility()I', 'isInEditMode()Z', 'setForceDarkAllowed(Z)V', 'isForceDarkAllowed()Z', 'setImportantForContentCapture(I)V', 'getImportantForContentCapture()I', 'getContentCaptureSession()Landroid/view/contentcapture/ContentCaptureSession;', 'setViewTranslationCallback(Landroid/view/translation/ViewTranslationCallback;)V', 'clearViewTranslationCallback()V', 'getViewTranslationCallback()Landroid/view/translation/ViewTranslationCallback;', 'setWindowInsetsAnimationCallback(Landroid/view/WindowInsetsAnimation$Callback;)V', 'getUniqueDrawingId()J', 'awakenScrollBars()Z', 'awakenScrollBars(I)Z', 'awakenScrollBars(IZ)Z', 'addOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V', 'removeOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V', 'isAttachedToWindow()Z', 'onAttachedToWindow()V', 'onDetachedFromWindow()V', 'onVisibilityChanged(Landroid/view/View;I)V', 'onWindowVisibilityChanged(I)V']);
add(CONFIGURATION, ['equals(Landroid/content/res/Configuration;)Z', 'equals(Ljava/lang/Object;)Z', 'getLayoutDirection()I', 'getLocales()Landroid/os/LocaleList;', 'setLocales(Landroid/os/LocaleList;)V', 'setLocale(Ljava/util/Locale;)V']);
add(LOCALE, ['clone()Ljava/lang/Object;', 'getScript()Ljava/lang/String;', '<init>(Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V', 'getDefault()Ljava/util/Locale;', 'forLanguageTag(Ljava/lang/String;)Ljava/util/Locale;', 'getLanguage()Ljava/lang/String;', 'getCountry()Ljava/lang/String;', 'getVariant()Ljava/lang/String;', 'toLanguageTag()Ljava/lang/String;', 'toString()Ljava/lang/String;', 'equals(Ljava/lang/Object;)Z']);
add(LOCALES, ['<init>([Ljava/util/Locale;)V', 'get(I)Ljava/util/Locale;', 'size()I', 'isEmpty()Z', 'indexOf(Ljava/util/Locale;)I', 'toLanguageTags()Ljava/lang/String;', 'getDefault()Landroid/os/LocaleList;', 'getAdjustedDefault()Landroid/os/LocaleList;', 'getEmptyLocaleList()Landroid/os/LocaleList;', 'forLanguageTags(Ljava/lang/String;)Landroid/os/LocaleList;', 'getFirstMatch([Ljava/lang/String;)Ljava/util/Locale;']);
add(CONFIGURATION, ['<init>()V', '<init>(Landroid/content/res/Configuration;)V']);
add(INFLATER, ['from(Landroid/content/Context;)Landroid/view/LayoutInflater;', 'getContext()Landroid/content/Context;', 'getFactory()Landroid/view/LayoutInflater$Factory;', 'getFactory2()Landroid/view/LayoutInflater$Factory2;', 'setFactory(Landroid/view/LayoutInflater$Factory;)V', 'setFactory2(Landroid/view/LayoutInflater$Factory2;)V', 'cloneInContext(Landroid/content/Context;)Landroid/view/LayoutInflater;', 'inflate(ILandroid/view/ViewGroup;)Landroid/view/View;', 'inflate(ILandroid/view/ViewGroup;Z)Landroid/view/View;']);
for (const owner of ['Landroid/view/ViewGroup;', 'Landroid/widget/LinearLayout;', 'Landroid/widget/FrameLayout;', 'Landroid/widget/ScrollView;']) add(owner, ['getChildAt(I)Landroid/view/View;', 'getChildCount()I', 'indexOfChild(Landroid/view/View;)I', 'removeViewAt(I)V', 'removeViews(II)V', 'addView(Landroid/view/View;)V', 'addView(Landroid/view/View;I)V', 'addView(Landroid/view/View;II)V', 'addView(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)V', 'addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V', 'removeView(Landroid/view/View;)V', 'removeAllViews()V']);
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
// A class of this table whose original AOSP source is in a framework DEX is implemented (unimplementedWidgetMessage looks at runtime.classes): docs/WIDGET-ORIGINALS.md has the status of each.
/** The concrete android.widget classes that are original AOSP classes of the layouts profile only (docs/WIDGET-ORIGINALS.md): an APK that uses one, in code or as a layout tag, loads the profile (src/apk-loader.js). */
export const LAYOUTS_PROFILE_WIDGETS = ['RelativeLayout', 'GridLayout', 'TableLayout', 'TableRow', 'AbsoluteLayout', 'HorizontalScrollView', 'CheckedTextView', 'ViewAnimator', 'ViewFlipper', 'ViewSwitcher', 'TextSwitcher', 'ImageSwitcher', 'ListView', 'GridView', 'ExpandableListView', 'Spinner', 'Gallery', 'AdapterViewFlipper',
  'TabHost', 'TabWidget', 'AutoCompleteTextView', 'MultiAutoCompleteTextView', 'NumberPicker', 'SearchView', 'DatePicker', 'TimePicker', 'CalendarView', 'MediaController'];
const LAYOUTS_PROFILE_CLASSES = new Set([...LAYOUTS_PROFILE_WIDGETS, 'AdapterView', 'AbsListView', 'AbsSpinner', 'AdapterViewAnimator'].map(name => `Landroid/widget/${name};`));
const READS_PARENT_FIELD = ['Landroid/widget/AbsSeekBar;', 'Landroid/widget/Gallery;'];   // see syncViewFields
const ORIGINAL_CLASS_STYLEABLES = { AbsSeekBar: ['SeekBar'], Spinner: ['ListPopupWindow', 'PopupWindow'], AutoCompleteTextView: ['ListPopupWindow', 'PopupWindow'], DayPickerView: ['CalendarView'] };   // CalendarViewMaterialDelegate builds its DayPickerView with the CalendarView's own AttributeSet   // see ownedByOriginalClass
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
  'android/widget/Space': 'android/view/View', 'android/view/ViewStub': 'android/view/View', 'android/widget/VideoView': 'android/view/SurfaceView',
}).map(([name, parent]) => [`L${name};`, `L${parent};`]));
/** What the original class of a still declared-only widget needs that the lab does not have (docs/WIDGET-ORIGINALS.md has the detail); named in the "Unsupported widget" error. */
const WIDGET_BLOCKERS = {
  'android/widget/VideoView': 'android.media.MediaPlayer, which the lab does not have, and the android.media subtitle classes (SubtitleController and its renderers)',
  'android/widget/QuickContactBadge': 'android.content.AsyncQueryHandler and com.android.internal.R.styleable.Theme (private theme attributes absent from the framework resource table)',
  'android/widget/Toolbar': 'android.widget.ActionMenuView and the internal menu classes (com.android.internal.view.menu)',
};
/** The declared widget classes (android-13.0.0_r1 names with '/'), for the test that tracks which of them are original classes and which are still blocked. */
export const DECLARED_WIDGET_CLASSES = Object.freeze(Object.keys(UNIMPLEMENTED_WIDGET_PARENTS).map(type => type.slice(1, -1)));
const WIDGET_PARENTS = { FrameLayout: 'Landroid/view/ViewGroup;', ScrollView: 'Landroid/widget/FrameLayout;', EditText: 'Landroid/widget/TextView;', CompoundButton: 'Landroid/widget/Button;', CheckBox: 'Landroid/widget/CompoundButton;', Switch: 'Landroid/widget/CompoundButton;', ProgressBar: 'Landroid/view/View;' };
add('Landroid/view/ViewGroup;', ['addViewInLayout(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)Z', 'addViewInLayout(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;Z)Z', 'removeViewInLayout(Landroid/view/View;)V', 'removeAllViewsInLayout()V', 'detachViewFromParent(I)V', 'detachViewFromParent(Landroid/view/View;)V', 'detachViewsFromParent(II)V', 'detachAllViewsFromParent()V', 'attachViewToParent(Landroid/view/View;ILandroid/view/ViewGroup$LayoutParams;)V', 'removeDetachedView(Landroid/view/View;Z)V']);
for (const owner of ['Landroid/view/ViewParent;', 'Landroid/view/ViewGroup;']) add(owner, ['onDescendantInvalidated(Landroid/view/View;Landroid/view/View;)V', 'requestDisallowInterceptTouchEvent(Z)V']);
for (const name of Object.keys(WIDGET_PARENTS)) add(`Landroid/widget/${name};`, ['<init>(Landroid/content/Context;)V']);
add('Landroid/widget/EditText;', ['getText()Landroid/text/Editable;']);
add('Landroid/widget/TextView;', ['setText(Ljava/lang/CharSequence;)V', 'addTextChangedListener(Landroid/text/TextWatcher;)V', 'removeTextChangedListener(Landroid/text/TextWatcher;)V', 'setHint(Ljava/lang/CharSequence;)V', 'getHint()Ljava/lang/CharSequence;']);
add('Landroid/widget/CompoundButton;', ['setChecked(Z)V', 'isChecked()Z', 'toggle()V', 'setOnCheckedChangeListener(Landroid/widget/CompoundButton$OnCheckedChangeListener;)V', 'setOnCheckedChangeWidgetListener(Landroid/widget/CompoundButton$OnCheckedChangeListener;)V', 'setDefaultStateDescription()V', 'getButtonStateDescription()Ljava/lang/CharSequence;', 'setStateDescription(Ljava/lang/CharSequence;)V', 'getStateDescription()Ljava/lang/CharSequence;']);
add('Landroid/widget/ProgressBar;', ['setProgress(I)V', 'getProgress()I', 'setMax(I)V', 'getMax()I', 'setIndeterminate(Z)V', 'isIndeterminate()Z']);
add('Landroid/view/View;', ['setVisibility(I)V', 'getVisibility()I', 'setBackgroundColor(I)V']);
add(EDITABLE, ['toString()Ljava/lang/String;', 'length()I', 'charAt(I)C', 'subSequence(II)Ljava/lang/CharSequence;']);
const VALUE_TYPES = new Map([['String', 'Ljava/lang/String;'], ['CharSequence', 'Ljava/lang/CharSequence;'], ['Int', 'I'], ['Long', 'J'], ['Boolean', 'Z'], ['Float', 'F'], ['Double', 'D'], ['Bundle', BUNDLE], ['PersistableBundle', 'Landroid/os/PersistableBundle;'], ['Parcelable', 'Landroid/os/Parcelable;'], ['Serializable', 'Ljava/io/Serializable;'], ['StringArray', '[Ljava/lang/String;'], ['IntArray', '[I'], ['ByteArray', '[B'], ['StringArrayList', 'Ljava/util/ArrayList;'], ['IntegerArrayList', 'Ljava/util/ArrayList;'], ['ParcelableArrayList', 'Ljava/util/ArrayList;'], ['ParcelableArray', '[Landroid/os/Parcelable;'], ['SparseParcelableArray', 'Landroid/util/SparseArray;'], ['LongArray', '[J'], ['FloatArray', '[F'], ['DoubleArray', '[D'], ['BooleanArray', '[Z'], ['CharArray', '[C'], ['ShortArray', '[S'], ['Byte', 'B'], ['Char', 'C'], ['Short', 'S'], ['Binder', 'Landroid/os/IBinder;'], ['CharSequenceArray', '[Ljava/lang/CharSequence;'], ['CharSequenceArrayList', 'Ljava/util/ArrayList;'], ['Size', 'Landroid/util/Size;'], ['SizeF', 'Landroid/util/SizeF;']]);
for (const owner of [BUNDLE, 'Landroid/os/BaseBundle;', 'Landroid/os/PersistableBundle;']) {
  add(owner, ['<init>()V', '<init>(I)V', `<init>(${BUNDLE})V`, 'size()I', 'isEmpty()Z', 'containsKey(Ljava/lang/String;)Z', 'remove(Ljava/lang/String;)V', 'clear()V', `putAll(${BUNDLE})V`, 'keySet()Ljava/util/Set;', 'get(Ljava/lang/String;)Ljava/lang/Object;', 'clone()Ljava/lang/Object;', 'deepCopy()Landroid/os/Bundle;', 'setClassLoader(Ljava/lang/ClassLoader;)V', 'getClassLoader()Ljava/lang/ClassLoader;']);
  if (owner !== 'Landroid/os/BaseBundle;') add(owner, ['<init>(Landroid/os/PersistableBundle;)V']);   // PersistableBundle(PersistableBundle) and Bundle(PersistableBundle) (API 21): a copy of its mappings
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
PARENTS.set('Landroid/content/res/Resources$Theme;', 'Ljava/lang/Object;');   // the theme objects of android-style-backend.js: Resources.Theme.class resolves (final class Theme, no superclass but Object)
for (const [type, parent] of Object.entries(UNIMPLEMENTED_WIDGET_PARENTS)) PARENTS.set(type, parent);
for (const [name, parent] of Object.entries(WIDGET_PARENTS)) PARENTS.set(`Landroid/widget/${name};`, parent); PARENTS.set(LOCALE, 'Ljava/lang/Object;'); PARENTS.set(LOCALES, 'Ljava/lang/Object;'); PARENTS.set('Landroid/os/Parcelable$ClassLoaderCreator;', 'Landroid/os/Parcelable$Creator;');
PARENTS.set('Landroid/content/pm/ComponentInfo;', 'Landroid/content/pm/PackageItemInfo;'); PARENTS.set('Landroid/content/pm/PackageItemInfo;', 'Ljava/lang/Object;');
PARENTS.set(PACKAGE_MANAGER, 'Ljava/lang/Object;'); PARENTS.set(COMPONENT, 'Ljava/lang/Object;'); for (const [type, parent] of Object.entries(PACKAGE_VALUE_PARENTS)) PARENTS.set(type, parent); for (const name of ['Secure', 'System', 'Global']) PARENTS.set(`Landroid/provider/Settings$${name};`, 'Landroid/provider/Settings$NameValueTable;');
PARENTS.set(CONFIGURATION, 'Ljava/lang/Object;'); PARENTS.set(METRICS, 'Ljava/lang/Object;');
PARENTS.set(INFLATER, 'Ljava/lang/Object;'); PARENTS.set(ATTRIBUTES, 'Landroid/util/AttributeSet;');
PARENTS.set(WINDOW, 'Ljava/lang/Object;'); PARENTS.set(PORTER_MODE, 'Ljava/lang/Enum;'); PARENTS.set(BLUR_STYLE, 'Ljava/lang/Enum;');
PARENTS.set('Landroid/view/ViewGroup;', 'Landroid/view/View;'); PARENTS.set('Landroid/widget/LinearLayout;', 'Landroid/view/ViewGroup;');
PARENTS.set(LAYOUT_PARAMS, 'Ljava/lang/Object;'); PARENTS.set(MARGIN_PARAMS, LAYOUT_PARAMS); PARENTS.set('Landroid/widget/LinearLayout$LayoutParams;', MARGIN_PARAMS); PARENTS.set('Landroid/widget/FrameLayout$LayoutParams;', MARGIN_PARAMS);
PARENTS.set(EDITABLE, 'Landroid/text/Editable;'); PARENTS.set('Landroid/text/Editable;', 'Ljava/lang/CharSequence;');
PARENTS.set(PROCESS_INFO, 'Ljava/lang/Object;');
PARENTS.set(KEY_SET, 'Ljava/util/AbstractSet;');   // the rest of Set (containsAll, toArray, equals, hashCode, removeAll, retainAll, toString, stream...) is libcore's AbstractSet over size/contains/remove/iterator, as Bundle.keySet() is ArrayMap's KeySet on Android
PARENTS.set(KEY_ITERATOR, 'Ljava/util/Iterator;');
const descriptor = (name) => name?.startsWith('L') ? name : `L${name.replaceAll('.', '/')};`;
const sameRef = (a, b) => a != null && b != null && typeof a.ref === 'number' && a.ref === b.ref;
const nullish = (value) => value == null || value === 0;
const nullishString = (runtime, value) => nullish(value) ? null : typeof value === 'string' ? value : runtime.stringCharacters(value);
// How many attributes of one tag a failed constructor or LayoutParams check is run again without, one at a time, before the failure is taken as not about an attribute.
const RECOVERY_CANDIDATES = 32;
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
const RESOURCES_NOT_FOUND = 'Landroid/content/res/Resources$NotFoundException;';
/** The unresolved lookups that are Android's own NotFoundException (src/android-resources.js absentKind): no entry in a loaded package, a package id nothing defines, no variant for the configuration. */
const ANDROID_ABSENCE = new Set(['entry', 'unknown', 'variant']);
export class AndroidPlatform {
  constructor({ resources = null, applicationName = null, packageName = null, manifest = null, apkBytes = null, device = null } = {}) { this.device = resolveDevice(device || {}); this.userDevice = this.device; this.clock = new VMClock(); this.apkBytes = apkBytes; this.manifest = manifest; this.resources = resources; this.applicationName = applicationName; this.packageName = packageName; this.application = null; this.applicationState = 'new'; this.tasks = []; this.nextTaskId = 1; this.starter = new ActivityStarter(this); this.activityInfos = new Map(); this.lastTransition = null; this.taskClosed = false; this.resourceObject = null; this.finishedActivities = new Set(); this.eventSequence = 0; this.looperHost = createLooperHost(this); this.runtimePermissions = createPermissionHost(this); this.virtualProcess = { source: 'browser-vm', pid: APP_PID, ppid: ZYGOTE_PID, uid: 10000, foreground: true }; this.transactionSequence = 0; this.porterModes = new Map(); this.blurStyles = new Map(); this.inflaters = new Map(); this.applicationCallbacks = []; this.styleBackend = new AndroidStyleBackend(this); this.viewTreeHost = createViewTreeHost(this); this.viewWindowHost = createViewWindowHost(this); this.canvasHost = createVectorCanvasHost(); this.paintHost = createPaintHost(); this.contentHost = createContentResolverHost(this); this.drawableViewHost = createDrawableViewHost(this); this.deviceServices = createDeviceServicesHost(this); this.insetsHost = createWindowInsetsHost(this); this.accessibilityService = createAccessibilityServiceHost(this); this.viewLayoutHost = createViewLayoutHost(this); this.autofillService = createAutofillServiceHost(this); this.inputMethodService = createInputMethodServiceHost(this); this.clipboardService = createClipboardServiceHost(this); this.viewInputHost = createViewInputHost(this); this.xmlHost = new AndroidXmlHost(this); this.localeService = createLocaleServiceHost(this); this.viewStateHost = createViewStateHost(); this.componentCallbacksHost = createComponentCallbacksHost(this); this.editableTextHost = createEditableTextHost(this); this.viewCoordinateHost = createViewCoordinateHost(this); this.viewTransformHost = createViewTransformHost(this); this.viewPropertyAnimatorHost = createViewPropertyAnimatorHost(this); this.viewOutlineHost = createViewOutlineHost(this); this.composeCanvasHost = createComposeCanvasHost(this); this.windowManagerGlobal = createWindowManagerGlobal(this); this.dialogWindowHost = createDialogWindowHost(this); this.systemServices = createSystemServicesHost(this); this.strictMode = createStrictModeHost(this); this.vmDebug = createVmDebugHost(this); this.javaIo = createJavaIoHost(this); this.classLoaders = createClassLoaderHost(this); this.appServices = createAppServicesHost(this); this.packages = createPackageRegistry(this); this.concurrency = createConcurrencyHost(this); this.methodHandles = createMethodHandlesHost(this); this.dateTime = createDateTimeHost(this); this.numberFormat = createNumberFormatHost(this); this.cookies = createCookieHost(this); this.viewApi = createViewApiHost(this); this.actionModes = createActionModeHost(this); this.textViewApi = createTextViewApiHost(this); this.intentApi = createIntentApiHost(this); this.activityApi = createActivityApiHost(this); this.contentResolverApi = createContentResolverApiHost(this); this.packageManagerApi = createPackageManagerApiHost(this); this.packageValueObjects = createPackageValueObjectsHost(this); this.networkInfoHost = createNetworkInfoHost(this); this.apkChecksumsHost = createApkChecksumsHost(this); this.remoteViews = createRemoteViewsHost(this); this.miscPlatform = createMiscPlatformHost(this); this.icuText = createIcuTextHost(this); this.toasts = createToastHost(this); this.platformData = createPlatformDataClassesHost(this); this.imageDecoder = createImageDecoderHost(this); this.animatedImages = createAnimatedImageHost(this); this.imageViewApi = createImageViewApiHost(this); this.progressBarApi = createProgressBarApiHost(this); this.viewGroupApi = createViewGroupApiHost(this); this.viewInternals = createViewInternalsHost(this); this.uriApi = createUriApiHost(this); this.formatter = createFormatterHost(this); this.security = createSecurityHost(this); this.jca = createJcaHost(this); this.compatCallbacks = createCompatCallbacksHost(this); this.reflection = createReflectionHost(this); this.serialization = createSerializationHost(this); this.bitmapCodec = createBitmapCodecHost(this); this.bitmapDrawable = createBitmapDrawableHost(this); this.imageView = createImageViewHost(this); this.webView = createWebViewHost(this); this.contentExtras = createContentExtrasHost(this); this.preferenceManager = createPreferenceManagerHost(this); this.processHost = createProcessHost(this); this.statsHost = createStatsHost(this); this.telephonyExtras = createTelephonyHost(this); this.surfaceTextureHost = createSurfaceTextureHost(); this.camera = createCameraHost(this); this.scaleGesture = createScaleGestureHost(this); this.buildHost = createBuildHost(this); this.sensorHost = createSensorHost(); this.geocoderHost = createGeocoderHost(this); this.coreLangHost = createCoreLangHost(this); this.resourcesExtras = createResourcesExtrasHost(this); this.simpleTimeZone = createSimpleTimeZoneHost(this); this.activityManagerExtras = createActivityManagerExtrasHost(this); this.managersExtras = createManagersExtrasHost(this); this.accountSessions = createAccountSessionsHost(this); this.strictMath = createStrictMathHost(); this.localeExtras = createLocaleExtrasHost(this); this.unicode = createUnicodeHost(this); this.messageFormat = createMessageFormatHost(this); this.settings = createSettingsHost(this); this.systemFeatures = new Set(DEVICE_FEATURES); this.hardwareServices = createHardwareServicesHost(this); this.peripheralServices = createPeripheralServicesHost(this); this.storageServices = createStorageServicesHost(this); this.systemManagers = createSystemManagersHost(this); this.javaServices = createJavaServicesHost(this); this.typefaceBuilder = createTypefaceBuilderHost(this); this.viewTouch = createViewTouchHost(this); this.magnifier = createMagnifierHost(this); this.displayHost = createDisplayHost(this); this.notifications = createNotificationHost(this); this.databaseSupport = createDatabaseSupportHost(this); this.shaderHost = createShaderHost(this); this.systemBarsHost = createSystemBarsHost(this); this.deviceState = createDeviceStateHost(this); this.jobScheduler = createJobSchedulerHost(this); this.pendingIntents = createPendingIntentHost(this); this.telephony = createTelephonySms(this); this.binderHost = createBinderHost(this); this.inputManagerHost = createInputManagerHost(this); this.backDispatcher = createBackDispatcherHost(this); this.rtAnimators = createRenderThreadAnimators(this); this.icuBidi = createIcuBidiHost(this); this.sharedStorage = createSharedStorageHost(this); this.contractHosts = [this.sharedStorage, this.camera, this.scaleGesture, this.systemServices, this.strictMode, this.vmDebug, this.javaIo, this.classLoaders, this.appServices, this.concurrency, this.methodHandles, this.looperHost, this.dateTime, this.numberFormat, this.cookies, this.viewApi, this.actionModes, this.textViewApi, this.intentApi, this.activityApi, this.contentResolverApi, this.packageManagerApi, this.packageValueObjects, this.networkInfoHost, this.apkChecksumsHost, this.remoteViews, this.miscPlatform, this.icuText, this.toasts, this.platformData, this.imageDecoder, this.animatedImages, this.imageViewApi, this.progressBarApi, this.viewGroupApi, this.viewInternals, this.uriApi, this.formatter, this.icuBidi, this.security, this.jca, this.compatCallbacks, this.reflection, this.serialization, this.bitmapCodec, this.bitmapDrawable, this.imageView, this.webView, this.contentExtras, this.preferenceManager, this.processHost, this.statsHost, this.telephonyExtras, this.surfaceTextureHost, this.buildHost, this.sensorHost, this.geocoderHost, this.coreLangHost, this.resourcesExtras, this.simpleTimeZone, this.activityManagerExtras, this.managersExtras, this.accountSessions, this.strictMath, this.localeExtras, this.unicode, this.messageFormat, this.settings, this.hardwareServices, this.peripheralServices, this.storageServices, this.systemManagers, this.javaServices, this.typefaceBuilder, this.viewTouch, this.magnifier, this.displayHost, this.notifications, this.databaseSupport, this.shaderHost, this.deviceState, this.jobScheduler, this.pendingIntents, this.binderHost, this.inputManagerHost, this.backDispatcher]; }
  readStatic(runtime, field) {
    for (const host of this.contractHosts) { const hosted = host.readStatic(runtime, field); if (hosted) return hosted; }
    // Android 13 Bundle.EMPTY: one singleton whose mMap is the immutable ArrayMap.EMPTY; any insertion throws UnsupportedOperationException("ArrayMap is immutable").
    if ((field.owner === BUNDLE || field.owner === 'Landroid/os/BaseBundle;') && field.name === 'EMPTY' && field.type === BUNDLE) { this.emptyBundles ??= new WeakMap(); if (!this.emptyBundles.has(runtime)) { const value = this.bundle(runtime); runtime.object(value).immutableEmpty = true; this.emptyBundles.set(runtime, value); (runtime.hostStaticValues ??= []).push(value); } return { handled: true, value: this.emptyBundles.get(runtime) }; }
    if (field.owner === 'Landroid/view/View;' && field.type === 'Z' && ['sUseBrokenMakeMeasureSpec', 'sUseZeroUnspecifiedMeasureSpec'].includes(field.name)) { const target = Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1); return { handled: true, value: field.name === 'sUseBrokenMakeMeasureSpec' ? (target <= 17 ? 1 : 0) : (target < 23 ? 1 : 0) }; } // Original AOSP View.java compatibility assignments, derived from actual manifest target.
    if (field.owner === 'Landroid/provider/Settings$Secure;' && field.type === 'Ljava/lang/String;' && ['LONG_PRESS_TIMEOUT', 'MULTI_PRESS_TIMEOUT'].includes(field.name)) return { handled: true, value: field.name.toLowerCase() }; // Original Settings.Secure key names; values live in the VM core-settings store.
    if (field.owner === 'Landroid/os/Trace;' && field.name === 'TRACE_TAG_VIEW' && field.type === 'J') return { handled: true, value: 8n }; // AOSP Trace.java: 1L << 3
    // View.EMPTY_STATE_SET ... PRESSED_ENABLED_FOCUSED_SELECTED_WINDOW_FOCUSED_STATE_SET (View.java: each is StateSet.get(the OR of its VIEW_STATE_* bits)), read through View or a subclass
    if (field.type === '[I' && field.name.endsWith('_STATE_SET') && runtime.isSubtype(field.owner, 'Landroid/view/View;')) {
      let rest = field.name.slice(0, -'_STATE_SET'.length), mask = 0;
      if (rest !== 'EMPTY') for (const [token, bit] of [['WINDOW_FOCUSED', 1], ['PRESSED', 16], ['ENABLED', 8], ['FOCUSED', 4], ['SELECTED', 2]]) { const next = rest.replace(new RegExp(`(^|_)${token}(?=_|$)`), ''); if (next !== rest) { mask |= bit; rest = next; } }
      if (rest === 'EMPTY' || rest.replaceAll('_', '') === '') return { handled: true, value: runtime.dispatch({ owner: 'Landroid/util/StateSet;', name: 'get', parameters: ['I'], result: '[I', signature: '(I)[I' }, [mask], 'static') };
    }
    if (field.owner === 'Landroid/view/View;' && field.type === 'Z' && field.name === 'sPreserveMarginParamsInLayoutParamConversion') return { handled: true, value: Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1) >= 24 ? 1 : 0 };
    if (field.owner === LOCALE && Object.hasOwn(LOCALE_CONSTANTS, field.name)) return { handled: true, value: this.locale(runtime, LOCALE_CONSTANTS[field.name]) };
    // android.graphics.BlurMaskFilter.Blur: NORMAL, SOLID, OUTER, INNER (BlurMaskFilter.java; the ordinal is its native_int, the SkBlurStyle of BlurMaskFilter(radius, style))
    if (field.owner === BLUR_STYLE && BLUR_STYLE_NAMES.includes(field.name)) { if (!this.blurStyles.has(field.name)) { const ref = runtime.makeObject(BLUR_STYLE); Object.assign(runtime.object(ref), { enumName: field.name, enumOrdinal: BLUR_STYLE_NAMES.indexOf(field.name) }); this.blurStyles.set(field.name, ref); } return { handled: true, value: this.blurStyles.get(field.name) }; }
    if (field.owner === PORTER_MODE) { const names = ['CLEAR', 'SRC', 'DST', 'SRC_OVER', 'DST_OVER', 'SRC_IN', 'DST_IN', 'SRC_OUT', 'DST_OUT', 'SRC_ATOP', 'DST_ATOP', 'XOR', 'DARKEN', 'LIGHTEN', 'MULTIPLY', 'SCREEN', 'ADD', 'OVERLAY']; if (names.includes(field.name)) { if (!this.porterModes.has(field.name)) { const ref = runtime.makeObject(PORTER_MODE); Object.assign(runtime.object(ref), { enumName: field.name, enumOrdinal: names.indexOf(field.name) }); this.porterModes.set(field.name, ref); } return { handled: true, value: this.porterModes.get(field.name) }; } }
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
    if (runtime.classes.has(type)) return null;
    // An original class of the layouts profile: the class exists, the profile was not loaded for this APK (the load found no use of the widget, or the profile was switched off).
    // (AdapterViewFlipper is one the lab never declared: without the profile its name resolves to nothing, and Class.forName says this instead of ClassNotFoundException.)
    if (!Object.hasOwn(UNIMPLEMENTED_WIDGET_PARENTS, type) && !LAYOUTS_PROFILE_CLASSES.has(type)) return null;
    if (LAYOUTS_PROFILE_CLASSES.has(type)) return `Unsupported widget ${type.slice(1, -1).replaceAll('/', '.')}: its original class is in the layouts profile, which is not loaded for this APK (the profile is loaded when the APK's code or a layout names the widget; docs/WIDGET-ORIGINALS.md)`;
    const blocker = WIDGET_BLOCKERS[type.slice(1, -1)];
    return `Unsupported widget ${type.slice(1, -1).replaceAll('/', '.')}: the lab declares the class but does not implement it, so constructing it would yield a View that cannot measure, draw or take input${blocker ? ` (it needs ${blocker}; docs/WIDGET-ORIGINALS.md)` : ''}`;
  }
  /** SystemServiceRegistry's class -> Context.*_SERVICE name table, over every service host. */
  serviceNameForClass(type) { return CORE_SERVICE_CLASSES[type] ?? this.javaServices.serviceNameForClass(type) ?? this.appServices.serviceNameForClass(type) ?? this.hardwareServices.serviceNameForClass(type) ?? this.peripheralServices.serviceNameForClass(type) ?? this.storageServices.serviceNameForClass(type) ?? this.systemManagers.serviceNameForClass(type); }
  /** Services a phone lacks entirely: getSystemService(name) answers null (WifiP2pManager without Wi-Fi Direct, MidiManager without MIDI, CredentialManager without a provider). */
  get nullServices() { return [...this.peripheralServices.nullServices, ...this.systemManagers.nullServices]; }
  // android.view.View implements KeyEvent.Callback (View.java): KeyEvent.dispatch calls onKeyDown / onKeyUp / onKeyMultiple on the View through that interface, which is how a key
  // no listener and no focused component consumed ends in View's own defaults instead of an IncompatibleClassChangeError.
  interfaces(type) { return [...this.contractHosts.flatMap(host => host.interfacesOf(type)), ...([INTENT, BUNDLE, 'Landroid/net/Uri;'].includes(type) ? ['Landroid/os/Parcelable;'] : []), ...([INTENT, BUNDLE].includes(type) ? ['Ljava/lang/Cloneable;'] : []), ...(type === 'Landroid/view/View;' ? ['Landroid/view/KeyEvent$Callback;'] : type === 'Landroid/view/ViewGroup;' ? ['Landroid/view/ViewParent;', 'Landroid/view/ViewManager;'] : []), ...(type === ACTIVITY ? ['Landroid/view/LayoutInflater$Factory2;', 'Landroid/view/Window$Callback;', 'Landroid/view/KeyEvent$Callback;', 'Landroid/view/View$OnCreateContextMenuListener;', 'Landroid/content/ComponentCallbacks2;'] : type === 'Landroid/app/Application;' ? ['Landroid/content/ComponentCallbacks2;'] : []), ...this.xmlHost.interfaces(type), ...(this.dialogWindowHost.interfaces?.(type) || []), ...(this.insetsHost.interfaces?.(type) || []), ...(this.viewWindowHost.interfaces(type) || []), ...this.drawableViewHost.interfaces(type)]; }
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
    // a Context of a second installed package (src/package-registry.js): the configuration Context and its Resources stay that package's (its own table, under the merged Configuration)
    const owner=this.packages.multi?this.packages.contextEntry(runtime,receiver):null,companion=owner&&!owner.main?owner:null;
    Object.assign(runtime.object(context),{baseContext:receiver,packageName:companion?companion.name:this.packageName,contextResources:resources,...(companion?{packageEntry:companion}:{})});if(companion)runtime.object(resources).packageEntry=companion;
    Object.assign(runtime.object(resources),{contextConfiguration:merged,resourceConfigurationDifference:changes});
    runtime.record(`CONTEXT configuration cloned/merged by original AOSP DEX; resource delta=0x${(changes>>>0).toString(16)}`);return context;
  }
  /** The Resources whose configuration differs from the device (a createConfigurationContext Resources), else null. Without the original matcher an override identical to the device still follows the device. */
  overrideResources(runtime, resources) {
    if (!resources || typeof resources !== 'object') return null;
    const object = runtime.object(resources); if (!object.contextConfiguration) return null;
    return object.resourceConfigurationDifference === 0 && typeof this.resourceSelector?.withProfile !== 'function' ? null : resources;
  }
  /** ResourceConfigProvider profile of a Configuration: the device profile overlaid with every field the Configuration sets (what AssetManager.setConfiguration receives from ResourcesImpl.updateConfiguration). */
  selectionProfileFor(runtime, configuration) {
    const base = this.resourceSelector?.profile?.() ?? WEB_DEVICE_CONFIGURATION, fields = runtime.object(configuration).fields;
    const int = name => fields.get(`${CONFIGURATION}->${name}:I`) | 0, text = value => typeof value === 'string' ? value : value == null ? '' : runtime.stringCharacters(value);
    const profile = { ...base }, set = (key, value) => { if (value) profile[key] = value; };
    set('mcc', int('mcc')); set('mnc', int('mnc')); set('touchscreen', int('touchscreen')); set('keyboard', int('keyboard')); set('navigation', int('navigation'));
    set('orientation', int('orientation')); set('uiMode', int('uiMode')); set('colorMode', int('colorMode'));
    const density = int('densityDpi'); if (density > 0 && density < 0xfffe) profile.density = density;
    set('widthDp', int('screenWidthDp')); set('heightDp', int('screenHeightDp')); set('smallestWidthDp', int('smallestScreenWidthDp'));
    const layout = int('screenLayout'); set('screenLayout', layout & 0xff); set('screenLayout2', (layout >> 8) & 0xff);
    const keysHidden = int('keyboardHidden'), navHidden = int('navigationHidden');
    if (keysHidden || navHidden) profile.inputFlags = (keysHidden || (base.inputFlags & 3)) | ((navHidden || ((base.inputFlags >> 2) & 3)) << 2);
    const list = runtime.dispatch({ owner: CONFIGURATION, name: 'getLocales', parameters: [], result: LOCALES, signature: `()${LOCALES}` }, [configuration], 'virtual');
    if (list && runtime.dispatch({ owner: LOCALES, name: 'size', parameters: [], result: 'I', signature: '()I' }, [list], 'virtual') > 0) {
      const locale = runtime.dispatch({ owner: LOCALES, name: 'get', parameters: ['I'], result: LOCALE, signature: `(I)${LOCALE}` }, [list, 0], 'virtual'), data = runtime.object(locale).localeData;
      const part = (name, value) => data ? data[name] : text(runtime.dispatch({ owner: LOCALE, name: value, parameters: [], result: 'Ljava/lang/String;', signature: '()Ljava/lang/String;' }, [locale], 'virtual'));
      Object.assign(profile, { language: part('language', 'getLanguage'), region: part('country', 'getCountry'), script: part('script', 'getScript'), variant: part('variant', 'getVariant') });
    }
    return profile;
  }
  /** Runs `action` with the resource table of companion package `entry` in place of the app's (Resources of that package's Contexts), on the device configuration. */
  /**
   * The resource environment every lookup uses now: the package scope set by withPackageResources (a companion package's own resources.arsc), else the app's. Each installed
   * package has its own table and ids (both start at 0x7f), so a lookup must happen in the table of the package whose Resources, Theme, Context or Activity it is made for.
   */
  get resources() { const scope = this.resourceScope; if (scope) return scope.environment; if (this.companionUi) { const entry = this.foregroundPackage(); if (entry && this.packages.hasResources(entry)) return this.packages.resourcesEnvironment(entry); } return this.appResources; }
  set resources(value) { this.appResources = value; }
  /**
   * The installed package whose resources are in scope now: the scope set by withPackageResources; outside one, once a second package has a window (companionUi), the package of
   * the current Activity (what the device does for that window between the app's own calls: its traversal, layout and input); else the app.
   */
  get resourcePackageEntry() { return this.resourceScope?.entry ?? (this.companionUi ? this.foregroundPackage() : null) ?? this.packages.main; }
  /** The companion package in scope, or null for the app (src/android-style-backend.js: its Resources object and the package of a new Theme). */
  get resourcePackage() { const entry = this.resourcePackageEntry; return entry.main ? null : entry; }
  /** The package of the current Activity (runtime.activity), when it is a second installed package's. */
  foregroundPackage() { const runtime = this.vmRuntime, activity = runtime?.activity; return activity && typeof activity === 'object' ? runtime.object(activity).packageEntry ?? null : null; }
  /** Runs `action` with the resources of package `entry` (a companion's own resources.arsc, or the app's for the app) in scope, on the device configuration. Nestable. */
  withPackageResources(runtime, entry, action) {
    if (!entry || entry === this.resourcePackageEntry) return action();
    const environment = entry.main ? this.appResources : this.packages.resourcesEnvironment(entry), previous = this.resourceScope ?? null, previousRuntime = runtime.resources, active = this.activeResources ?? null;
    const before = this.resources; this.resourceScope = { entry, environment }; this.activeResources = null; if (previousRuntime === before) runtime.resources = environment;
    try { return action(); } finally { this.resourceScope = previous; this.activeResources = active; if (previousRuntime === before) runtime.resources = previousRuntime; }
  }
  /**
   * The package whose resources a host call is made for, or null to keep the scope: the package tagged on the receiver (a companion's Resources, Theme, AssetManager, Context,
   * Activity, LayoutInflater or View), the package of the Context a View is constructed for, and, once a second package has a window, the app for the app's own Resources,
   * Themes and Contexts. Resources lookups were switched this way since companions got resources; the rest only once a companion Activity exists (companionUi), so a run
   * without one keeps its single-package path.
   */
  packageScopeOf(runtime, method, args, mode) {
    const receiver = mode === 'static' ? null : args[0];
    if (!receiver || typeof receiver !== 'object') return null;
    const owner = method.owner;
    if (!this.companionUi) return owner === 'Landroid/content/res/Resources;' ? runtime.object(receiver).packageEntry ?? null : null;
    const tagged = runtime.object(receiver).packageEntry;
    if (tagged) return tagged.main || this.packages.hasResources(tagged) ? tagged : null;
    if (method.name === '<init>' && method.parameters[0] === 'Landroid/content/Context;' && args[1] && typeof args[1] === 'object') { const entry = this.packages.contextEntry(runtime, args[1]); return entry.main || this.packages.hasResources(entry) ? entry : null; }
    if (owner === 'Landroid/content/res/Resources;' || owner === 'Landroid/content/res/Resources$Theme;') return this.packages.main;
    if (CONTEXTS.includes(owner)) { const entry = this.packages.contextEntry(runtime, receiver); return entry.main || this.packages.hasResources(entry) ? entry : null; }
    return null;
  }
  /** The installed package an Activity class belongs to: a companion's Activities are defined under its loader alias (src/package-registry.js); everything else is the app's. */
  activityPackage(runtime, type) {
    if (!this.packages.multi) return this.packages.main;
    const cache = this.activityPackages ??= new Map(); let entry = cache.get(type);
    if (entry === undefined) cache.set(type, entry = this.packages.entryOfClass(runtime ?? this.vmRuntime, type) ?? this.packages.main);
    return entry;
  }
  /** The <activity> declaration of an Activity class in its own package's manifest. */
  activityDeclaration(runtime, type) {
    if (systemActivityDeclaration(type)) return this.systemDeclaration(type);   // an Activity of the "android" package (src/system-activities.js)
    const entry = this.activityPackage(runtime, type), name = dottedName(type).replace(/\$\$ldr\d+$/, ''), plain = `L${name.replaceAll('.', '/')};`;
    return (entry.manifest?.activities ?? []).find(value => value.descriptor === plain || value.name === name) ?? null;
  }
  /** The <activity> declaration of a system Activity (core/res/AndroidManifest.xml), with its framework theme and label ids. */
  systemDeclaration(type) {
    const cache = this.systemDeclarations ??= new Map(); let declaration = cache.get(type);
    if (declaration === undefined) { const framework = this.resources?.frameworkTable; cache.set(type, declaration = resolvedSystemDeclaration(type, name => framework?.findId?.(name) ?? null)); }
    return declaration;
  }
  /**
   * An explicit Activity of the "android" package: one of the system Activities the device has (src/system-activities.js), compiled into a loaded framework profile, started by anyone when
   * it is exported and only by the system's own Activities otherwise; else ActivityNotFoundException, as for a component no package declares.
   */
  systemActivityTarget(runtime, intent, className) {
    const name = className.startsWith('.') ? SYSTEM_PACKAGE + className : className, type = descriptor(name), declaration = systemActivityDeclaration(type), component = `{${SYSTEM_PACKAGE}/${name}}`;
    const loaded = !!declaration && !!(runtime.bootClasses?.has?.(type) ?? runtime.dex?.bootClasses?.has?.(type));
    if (!loaded) {
      runtime.record(`ACTIVITY start refused: ${component} is not an Activity the virtual device's android package has (${declaration ? 'its framework profile is not loaded' : `it has ${systemActivityNames().join(', ')}`}) (ActivityNotFoundException)`);
      runtime.throwJava('Landroid/content/ActivityNotFoundException;', `Unable to find explicit activity class ${component}; have you declared this activity in your AndroidManifest.xml?`);
    }
    if (!declaration.exported && !this.packages.systemUiCode?.(runtime)) {
      const message = `Permission Denial: starting Intent { cmp=${SYSTEM_PACKAGE}/${name} } not exported from uid 1000`;
      runtime.record(`LOG W ActivityTaskManager: ${message}`); runtime.throwJava('Ljava/lang/SecurityException;', message);
    }
    runtime.record(`ACTIVITY ${component}: the system's own Activity (framework-aosp/profiles/accounts)`);
    return type;
  }
  /** A View or LayoutInflater made for a Context of a second installed package belongs to that package: its host calls resolve in that package's resources (packageScopeOf). */
  tagPackageView(runtime, object, context) {
    if (!this.companionUi || !context || typeof context !== 'object') return;
    const entry = this.packages.contextEntry(runtime, context); if (!entry.main) object.packageEntry = entry; else if (object.packageEntry) delete object.packageEntry;
  }
  /** Runs `action` in the resource scope of the package that owns `frame`'s Activity (its lifecycle callbacks, results, new intents, its window's traversal). */
  inFramePackage(runtime, frame, action) { return this.companionUi && frame ? this.withPackageResources(runtime, frame.packageEntry ?? this.packages.main, action) : action(); }
  /** Runs `action` with resource selection, themes and DisplayMetrics following `resources` (null = the virtual device). Synchronous, nestable; Java code run inside re-enters through the same guard. */
  withResources(runtime, resources, action) {
    const target = this.overrideResources(runtime, resources), previous = this.activeResources ?? null;
    if (previous === target) return action();
    if (target && typeof this.resourceSelector?.withProfile !== 'function') error('Resource selection for a Context configuration requires the original AOSP resource-configuration matcher', { kind: 'configuration-resources-unsupported', changes: runtime.object(target).resourceConfigurationDifference });
    this.activeResources = target;
    try {
      if (!this.resourceSelector?.withProfile) return action();
      const object = target ? runtime.object(target) : null;
      if (object) { try { object.selectionProfile ??= this.selectionProfileFor(runtime, object.contextConfiguration); this.resourceSelector.validate?.(object.selectionProfile); } catch (cause) { if (cause?.kind) throw cause; error(`Resource selection for this Context configuration cannot be served: ${cause.message}`, { kind: 'configuration-resources-unsupported', changes: object.resourceConfigurationDifference }); } }
      return this.resourceSelector.withProfile(object?.selectionProfile ?? null, action);
    } finally { this.activeResources = previous; }
  }
  /** DisplayMetrics of a configuration Resources (ResourcesImpl.updateConfiguration): the device display with densityDpi, density = dpi/160 and scaledDensity = density * fontScale taken from its Configuration. */
  metricsFor(runtime, resources) {
    const object = runtime.object(resources); if (object.displayMetrics) return object.displayMetrics;
    const device = this.deviceMetrics(runtime), metrics = (runtime.classes || runtime.dex.classes).has(METRICS) ? runtime.allocate(METRICS) : runtime.makeObject(METRICS);
    if ((runtime.classes || runtime.dex.classes).has(METRICS)) runtime.dispatch({ owner: METRICS, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [metrics], 'direct');
    const fields = runtime.object(metrics).fields; for (const [key, value] of runtime.object(device).fields) runtime.storeField(fields, key, value);
    const configuration = runtime.object(object.contextConfiguration).fields, dpi = configuration.get(`${CONFIGURATION}->densityDpi:I`) | 0, scale = bitsFloat(configuration.get(`${CONFIGURATION}->fontScale:F`) | 0) || 1;
    if (dpi > 0 && dpi < 0xfffe) { const density = Math.fround(dpi / 160); runtime.storeField(fields, `${METRICS}->densityDpi:I`, dpi); runtime.storeField(fields, `${METRICS}->density:F`, floatBits(density)); runtime.storeField(fields, `${METRICS}->scaledDensity:F`, floatBits(Math.fround(density * scale))); }
    else runtime.storeField(fields, `${METRICS}->scaledDensity:F`, floatBits(Math.fround(bitsFloat(fields.get(`${METRICS}->density:F`) | 0) * scale)));
    return object.displayMetrics = metrics;
  }
  /** Resources.updateConfiguration on a configuration Resources (ResourcesImpl.updateConfiguration): merge the delta into its Configuration, re-select, replay live Themes. */
  updateOverrideConfiguration(runtime, resources, incoming, metricsArg) {
    const object = runtime.object(resources);
    if (metricsArg !== null && metricsArg !== 0 && metricsArg !== undefined && metricsArg.ref !== this.metricsFor(runtime, resources).ref) {
      const mine = runtime.object(this.metricsFor(runtime, resources)).fields, theirs = runtime.object(metricsArg).fields;
      for (const field of ['widthPixels', 'heightPixels', 'densityDpi']) if (mine.get(`${METRICS}->${field}:I`) !== theirs.get(`${METRICS}->${field}:I`)) error('Resources.updateConfiguration with DisplayMetrics that differ from the Context configuration is not installed', { kind: 'configuration-resources-unsupported', field });
    }
    if (incoming !== null && incoming !== 0 && incoming !== undefined) {
      runtime.dispatch({ owner: CONFIGURATION, name: 'updateFrom', parameters: [CONFIGURATION], result: 'I', signature: `(${CONFIGURATION})I` }, [object.contextConfiguration, incoming], 'virtual');
      object.resourceConfigurationDifference = runtime.dispatch({ owner: CONFIGURATION, name: 'diff', parameters: [CONFIGURATION], result: 'I', signature: `(${CONFIGURATION})I` }, [this.resourceConfiguration(runtime, null), object.contextConfiguration], 'virtual');
      delete object.selectionProfile; delete object.displayMetrics;
    }
    this.styleBackend.refreshThemes(runtime);
  }
  attachActivityContext(runtime, activity) {
    const object = runtime.object(activity); if (object.activityContextAttached) return;
    // ActivityThread.createBaseContextForActivity: a ContextImpl of the Activity's own package (LoadedApk), so a second package's Activity reads its own resources, assets,
    // data directories and class loader (src/package-registry.js), and its theme comes from its own manifest.
    const entry = this.activityPackage(runtime, object.type), context = entry.main ? runtime.makeObject(APP_CONTEXT) : this.packages.newContext(runtime, entry);
    Object.assign(runtime.object(context), { packageName: entry.main ? this.packageName : entry.name, outerContext: activity });
    if (systemActivityDeclaration(object.type)) { runtime.object(context).systemPackageName = SYSTEM_PACKAGE; object.systemPackageName = SYSTEM_PACKAGE; }   // a system Activity's Context is of the "android" package
    runtime.dispatch({ owner: 'Landroid/content/ContextWrapper;', name: 'attachBaseContext', parameters: ['Landroid/content/Context;'], result: 'V', signature: '(Landroid/content/Context;)V' }, [activity, context], 'virtual');
    object.activityContextAttached = true;
    const declaration = this.activityDeclaration(runtime, object.type);
    const theme = declaration?.theme || entry.manifest?.application?.theme;
    // Context/theme transport: carry the manifest choice before onCreate.
    // Resource bags are resolved by the original wrapper on first getTheme.
    if(theme){object.themeResId=theme|0;const owner='Landroid/view/ContextThemeWrapper;';if(runtime.dex.bootClasses?.has(owner))runtime.storeField(object.fields,owner+'->mThemeResource:I',theme|0);}
    // The Activity is launched in the orientation its manifest (or, after a relaunch, its record) asks for, before onCreate: the other Activities of the task catch up when they come back.
    this.refreshOrientation(runtime, this.frame(runtime, activity));
  }
  /** SCREEN_ORIENTATION_* the Activity currently asks for: its record's request, else android:screenOrientation (default UNSPECIFIED). */
  requestedOrientationOf(frame) {
    const declared = frame.record?.requestedOrientation; if (declared !== undefined) return declared;
    const declaration = this.activityDeclaration(this.vmRuntime, frame.type);
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
  /** What the page's Orientation control shows: the fixed request of the Activity on top (BEHIND walks down the stack, as forcedOrientationFor) with the Activity that made it,
   *  or null when the user's rotation decides, the app is in the background or no Activity is open. Read-only (a snapshot field). */
  orientationLock(top = this.frames.at(-1)) {
    if (!top || this.taskClosed || this.taskInBackground) return null;
    const stack = this.taskOf(top)?.frames || this.frames; let index = stack.indexOf(top); if (index < 0) index = stack.length;
    for (let frame = top; frame; ) {
      const request = this.requestedOrientationOf(frame);
      if (request !== 3) {
        const lock = orientationLockOf(request, request === 14 ? frame.record?.lockedOrientation ?? this.device.orientation : this.device.orientation);
        return lock && { ...lock, activity: frame.type?.startsWith?.('L') ? frame.type.slice(1, -1).replaceAll('/', '.') : String(frame.type ?? ''), source: frame.record?.requestedOrientation !== undefined ? 'setRequestedOrientation' : 'manifest' };
      }
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
  /** The user leaves the app for the launcher or the recents (Home button, the swipe-up gesture): onUserLeaveHint and onPause on the resumed Activity, then onStop; every task is in the background until resumeTask(). */
  goHome(runtime) {
    const top = this.frames.at(-1); if (!top || this.taskInBackground) return false;
    if (top.lifecycleStage === 4) this.pauseForLaunch(runtime, top, true);
    this.taskInBackground = true; this.stopFrame(runtime, top);
    runtime.record('ACTIVITY task left for the launcher'); return true;
  }
  resumeTask(runtime) {
    const frame = this.frames.at(-1); if (!frame || !this.taskInBackground) return false; this.taskInBackground = false;
    if (frame.lifecycleStage === 2) this.lifecycleCall(runtime, frame.activity, 'onRestart'); if (frame.lifecycleStage <= 2) this.lifecycleCall(runtime, frame.activity, 'onStart'); this.lifecycleCall(runtime, frame.activity, 'onResume');
    runtime.record('ACTIVITY task brought to front'); return true;
  }
  // ---- Tasks (ActivityTaskManager / Task): the tasks[] list is the recents order, the last entry is the foreground task; `frames` is the foreground task's Activity stack. ----------------------------------
  get frames() { return this.tasks.at(-1)?.frames ?? []; }
  allFrames() { return this.tasks.flatMap(task => task.frames); }
  /** The record of `activity`: a live frame, or one finished but not stopped yet (finish() pauses it at once and stops and destroys it once the next Activity is idle). */
  activityFrame(activity) { return this.allFrames().find(frame => sameRef(frame.activity, activity)) ?? this.stoppingFrames?.find(frame => sameRef(frame.activity, activity)) ?? null; }
  taskOf(frame) { return this.tasks.find(task => task.frames.includes(frame)) ?? null; }
  taskById(id) { return this.tasks.find(task => task.id === id) ?? null; }
  /** The task-related manifest attributes of an Activity class (launchMode, taskAffinity, noHistory, ...). */
  activityInfo(type) { let info = this.activityInfos.get(type); if (!info) { const system = systemActivityDeclaration(type) ? this.systemDeclaration(type) : null, entry = system ? null : this.activityPackage(this.vmRuntime, type); this.activityInfos.set(type, info = system ? activityInfoOf({ activities: [system], application: {} }, SYSTEM_PACKAGE, type) : activityInfoOf(entry.manifest, entry.main ? this.packageName : entry.name, type)); } return info; }
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
    Object.assign(runtime.object(out), { target: intent.target ?? null, componentPackage: intent.componentPackage ?? null, action: intent.action ?? null, flags: flags | 0, data: intent.data ?? null, mimeType: intent.mimeType ?? null, identifier: intent.identifier ?? null, package: intent.package ?? null, component: intent.component ?? null,
      categories: intent.categories ? [...intent.categories] : undefined, clipData: intent.clipData ?? null, extras: new Map(intent.extras || []), extrasPresent: !!intent.extrasPresent || !!intent.extras?.size, extrasClassLoader: intent.extrasClassLoader ?? null });
    if (intent.launchedFrom) runtime.object(out).launchedFrom = intent.launchedFrom;   // the start's caller travels with the Intent the system delivers
    return out;
  }
  recordTransition(runtime, transition, source) {
    const override = source?.overrideTransition ?? null; if (source) source.overrideTransition = null;
    this.lastTransition = { ...transition, enterAnim: transition.animated && override ? override.enter : 0, exitAnim: transition.animated && override ? override.exit : 0, overridden: transition.animated && !!override };
  }
  /** The Activity instance a launch creates (ActivityThread.performLaunchActivity -> onCreate -> onStart -> onResume) inside `task`. */
  createInstance(runtime, target, delivered, task, options = {}) {
    // An Activity of a second installed package (ActivityThread.performLaunchActivity with that package's LoadedApk): its process starts first (Application, providers,
    // src/package-registry.js), the instance is of its own class loader's class (the loader alias), and everything the launch runs is in that package's resource scope.
    const entry = this.activityPackage(runtime, target);
    if (!entry.main) { this.packages.ensureProcess(runtime, entry); this.companionUi = true; }
    return this.inFramePackage(runtime, { packageEntry: entry }, () => this.launchInstance(runtime, target, delivered, task, entry, options));
  }
  launchInstance(runtime, target, delivered, task, entry, { resultReceiver = null, requestCode = -1, flags = 0, noHistory = false, savedState = null } = {}) {   // savedState: only a background render that restores the covered instance's state (src/render-variant.js)
    const activity = runtime.allocate(target);
    const frame = { activity, type: target, component: this.componentNameOf(runtime, runtime.object(delivered), target), root: null, intent: delivered, finished: false, resultReceiver, resultRequestCode: requestCode, launchFlags: flags, noHistory, ...(savedState ? { savedState } : {}), ...(entry.main ? {} : { packageEntry: entry }) };
    if (!entry.main) { runtime.object(activity).packageEntry = entry; this.onPackageActivityStart?.(runtime, entry, dottedName(target)); }   // its Context calls, Resources and window resolve in its own package; a device option names its package's screens (src/microg-device.js)
    this.deviceState.applyAnimatorScale(runtime, this.device.animatorScale, true);
    task.frames.push(frame); this.taskClosed = false;
    runtime.activity = activity; runtime.activityType = target; runtime.root = null;
    runtime.record(`ACTIVITY start ${target}`);
    runtime.dispatch({ owner: target, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [activity], 'direct');
    this.attachActivityContext(runtime, activity);
    this.performLifecycle(runtime, activity, 'onCreate', [savedState], () => runtime.dispatch({ owner: target, name: 'onCreate', signature: '(Landroid/os/Bundle;)V', parameters: ['Landroid/os/Bundle;'], result: 'V' }, [activity, savedState], 'virtual'));
    this.afterActivityCreate(runtime, activity);
    frame.root = runtime.root;
    if (!frame.root && this.launchAlive(frame)) this.emptyWindowContent(runtime, frame);
    return frame;
  }
  /**
   * An Activity that set no content View (one that only shows a dialog, as a permission or confirmation screen does): PhoneWindow still has its DecorView with an empty content
   * frame (android.R.id.content), drawn with the theme's windowBackground. The frame takes that empty content, through the platform's own Activity.setContentView(View).
   */
  emptyWindowContent(runtime, frame) {
    const type = 'Landroid/widget/FrameLayout;', root = runtime.allocate(type);
    runtime.dispatch({ owner: type, name: '<init>', signature: '(Landroid/content/Context;)V', parameters: ['Landroid/content/Context;'], result: 'V' }, [root, frame.activity], 'direct');
    runtime.record(`ACTIVITY ${dottedName(frame.type)} set no content View: its window shows the empty content frame`);
    this.invoke(runtime, { owner: ACTIVITY, name: 'setContentView', parameters: ['Landroid/view/View;'], result: 'V', signature: '(Landroid/view/View;)V' }, [frame.activity, root], 'virtual');
    return root;
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
  deliverNewIntent(runtime, frame, intent) { this.inFramePackage(runtime, frame, () => runtime.dispatch({ owner: frame.type, name: 'onNewIntent', signature: '(Landroid/content/Intent;)V', parameters: [INTENT], result: 'V' }, [frame.activity, intent], 'virtual')); }
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
  /** The device options this run has on (the trace and the page show them): null when none is on. */
  deviceOptionsSnapshot() { return this.microg ? { microg: { version: this.microg.version, packages: [...this.microg.packages], failures: this.microg.failures.map(item => ({ ...item })), entryPoints: describeMicrogEntryPoints(this.microg), unimplemented: describeMicrogStubs(this.microg), services: describeMicrogServices(this.microg), data: this.deviceData?.status?.() ?? null } } : null; }
  /** The package of a Context (ContextImpl.getPackageName): a companion package's Context names its own package, every other Context the app's. */
  contextPackageName(runtime, context) { return this.packages?.multi ? this.packages.contextEntry(runtime, context).name : this.packageName; }
  canAllocate(type) { if (type === 'Landroid/view/View;' || type === ACTIVITY) return true;   // `new Activity()`: Activity has a public no-arg constructor (an unattached instance, as a shrinker may leave behind)
    return this.contractHosts.some(host => host.canAllocate(type)) || this.dialogWindowHost.canAllocate(type) || this.canvasHost.canAllocate(type) || this.paintHost.canAllocate(type) || this.contentHost.canAllocate(type) || this.drawableViewHost.canAllocate(type) || [LOCALE, LOCALES, PACKAGE_MANAGER, COMPONENT, APPLICATION_INFO, ACTIVITY_INFO, CONFIGURATION, METRICS, INFLATER, ATTRIBUTES, ...PARAM_TYPES, EDITABLE, ...Object.keys(WIDGET_PARENTS).map(name => `Landroid/widget/${name};`), FRAGMENT, FRAGMENT_MANAGER, TRANSACTION, APPLICATION, APP_CONTEXT, PROCESS_INFO, INTENT, BUNDLE, 'Landroid/os/BaseBundle;', 'Landroid/os/PersistableBundle;', 'Landroid/content/res/Resources;'].includes(type); }
  supports(key) { return this.supportsUncached(key); }
  /** The result types of the methods this platform's method tables (KEYS, the style backend, the XML host) serve as `owner->name(params)`: reflection over a host-modelled
   *  class finds a served method whatever its result type (Intent.setFlags returns the Intent), not only one with a primitive result. */
  hostedResults(owner, name, params) {
    const content = this.contentHost?.keys ?? new Set(), size = KEYS.size + STYLE_METHODS.size + XML_METHODS.size + content.size;   // the content host's table too: Settings.Global.getString(ContentResolver, String) returns a String
    if (!hostedIndex || hostedIndex.size !== size) {
      const map = new Map();
      for (const set of [KEYS, STYLE_METHODS, XML_METHODS, content]) for (const key of set) { const close = key.lastIndexOf(')'); if (close < 0) continue; const prefix = key.slice(0, close + 1); (map.get(prefix) ?? map.set(prefix, []).get(prefix)).push(key.slice(close + 1)); }
      hostedIndex = { map, size };
    }
    return hostedIndex.map.get(`${owner}->${name}(${params})`) ?? [];
  }
  /** A method a host interface declares abstractly (host-contract abstractMethod): it exists for JNI and reflection; calls dispatch on the receiver. */
  declaresAbstract(key) { return this.contractHosts.some(host => host.declares?.(key)); }
  supportsUncached(key) { return this.contractHosts.some(host => host.supports(key)) || this.systemBarsHost.supports(key) || this.dialogWindowHost.supports(key) || this.viewOutlineHost.supports(key) || this.composeCanvasHost.supports(key) || this.viewTransformHost.supports(key) || this.viewPropertyAnimatorHost.supports(key) || this.viewCoordinateHost.supports(key) || this.editableTextHost.supports(key) || this.componentCallbacksHost.supports(key) || this.viewStateHost.supports(key) || this.localeService.supports(key) || this.viewWindowHost.supports(key) || this.canvasHost.supports(key) || this.paintHost.supports(key) || this.contentHost.supports(key) || this.drawableViewHost.supports(key) || this.deviceServices.supports(key) || this.insetsHost.supports(key) || this.accessibilityService.supports(key) || this.viewLayoutHost.supports(key) || this.autofillService.supports(key) || this.inputMethodService.supports(key) || this.clipboardService.supports(key) || this.viewInputHost.supports(key) || KEYS.has(key) || STYLE_METHODS.has(key) || this.viewTreeHost.supports(key) || XML_METHODS.has(key); }
  /** What the page shows in a View's box besides its children, in drawing order: the disappearing children of a group (a removed child whose Animation or LayoutTransition
   *  still runs: ViewGroup.dispatchDraw draws them after the children) and the Views of its overlay. */
  extraChildren(runtime, ref) {
    const view = runtime.object(ref), gone = view.vg?.disappearing?.length ? this.viewGroupApi.disappearing(runtime, ref).filter(child => !view.children.some(own => sameRef(own, child))) : [];
    return view.overlay ? [...gone, ...this.overlayChildren(runtime, ref)] : gone;
  }
  /** The child Views of a View's overlay (ViewOverlay.OverlayViewGroup), for the page: they are shown over the View's own children. Overlay drawables are drawn where the VM draws
   *  the View through a Canvas; the page has no element for them, which is said once. */
  overlayChildren(runtime, ref) {
    const group = this.viewApi.overlayView(runtime, ref); if (!group) return [];
    const object = runtime.object(group), drawables = object.fields.get('Landroid/view/ViewOverlay$OverlayViewGroup;->mDrawables:Ljava/util/ArrayList;');
    if (drawables && runtime.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'size', signature: '()I', parameters: [], result: 'I' }, [drawables], 'virtual') > 0) this.noteFrameworkGap(runtime, 'overlay-drawables-page', 'ViewOverlay.add(Drawable): the drawables of a View overlay are drawn where the VM draws the View through a Canvas; the page shows the overlay\'s Views only');
    return [...(object.children ?? [])];
  }
  /** A View got its overlay (View.getOverlay()): the OverlayViewGroup takes the host View's attachment, as its constructor takes mAttachInfo. */
  viewOverlayCreated(runtime, ref) { const view = runtime.object(ref), group = this.viewApi.overlayView(runtime, ref); if (group && view.attached) this.attachTree(runtime, group, true, new Set(), view.visibility ?? 0); }
  viewKind(runtime, object) {
    const kind = this.drawableViewHost.viewKind(runtime, object) ?? this.webView.viewKind(runtime, object) ?? this.camera.viewKind(runtime, object); if (kind) return kind;
    for (const [name, containerKind] of [['ScrollView', 'scroll'], ['LinearLayout', 'linear'], ['FrameLayout', 'frame']]) if (runtime.isSubtype(object.type, `Landroid/widget/${name};`)) return containerKind;
    if (runtime.isSubtype(object.type, 'Landroid/view/ViewGroup;')) return 'group';
    if (object.type === 'Landroid/view/View;' || (runtime.dex.classes.has(object.type) || runtime.classes.has(object.type)) && runtime.isSubtype(object.type, 'Landroid/view/View;') && !['TextView', 'ProgressBar'].some(name => runtime.isSubtype(object.type, `Landroid/widget/${name};`))) return 'view';
    return null;
  }
  /** The Activity a frame shows, as the page names it: its class, with its package in front for an Activity of a second installed package. */
  frameName(frame) { return frame.packageEntry ? `${frame.packageEntry.name}/${dottedName(frame.type)}` : dottedName(frame.type); }
  navigationState(runtime) { this.syncCurrent(runtime); const sourceBackHandler = !!runtime.activity && !!runtime.objectOverride(runtime.object(runtime.activity).type, 'onBackPressed()V'); return { sourceBackHandler, canGoBack: this.frames.length > 1 || this.tasks.length > 1 || sourceBackHandler, activityStack: this.frames.map((frame) => this.frameName(frame)), tasks: this.tasks.map((task) => ({ id: task.id, activityStack: task.frames.map((frame) => this.frameName(frame)) })), closed: this.taskClosed }; }
  frame(runtime, activity = runtime.activity) {
    let frame = this.allFrames().find((entry) => sameRef(entry.activity, activity)) ?? this.stoppingFrames?.find((entry) => sameRef(entry.activity, activity));
    if (!frame) {
      // An Activity that already finished (or was destroyed) keeps answering from a detached record: Context calls on it work as on Android (getResources, getTheme, getSystemService, ...); platform.frame() must not register it as live again.
      if (!nullish(activity) && this.finishedActivities.has(activity.ref)) return runtime.object(activity).detachedFrame ??= { activity, type: runtime.object(activity).type, finished: true, record: {}, root: null, intent: null };
      if (nullish(activity) || !runtime.isSubtype(runtime.object(activity).type, ACTIVITY)) {
        const thread = runtime.thread?.name ?? '?', api = runtime.lastHostCall ? String(runtime.lastHostCall) : 'unknown API', top = (runtime.thread?.frames ?? []).filter(f => f.method).slice(-6).reverse().map(f => `${f.method.owner.slice(1, -1).replaceAll('/', '.')}.${f.method.name}`).join(' <- ');
        const state = nullish(activity) ? 'no Activity is current (none started yet, or the last one finished and no other is resumed)' : `${runtime.typeOf(activity).slice(1, -1).replaceAll('/', '.')} is not an Activity`;
        error(`Activity context is unavailable: ${api} needs an Activity record; ${state}; thread ${thread}${top ? '; innermost Java frames: ' + top : ''}`, { kind: 'activity-context-unavailable', api, thread });
      }
      frame = { activity, type: runtime.object(activity).type, component: sameRef(activity, runtime.activity) && runtime.launcherComponent && dottedName(runtime.object(activity).type) === runtime.launcherActivity ? runtime.launcherComponent : dottedName(runtime.object(activity).type), root: sameRef(activity, runtime.activity) ? runtime.root : null, intent: this.takeLaunchIntent(runtime, activity), finished: false };   // the launcher Activity: the component the LAUNCHER filter is on (an alias, when it is one)
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
      if (field.type === 'Z' && ['sUseBrokenMakeMeasureSpec', 'sUseZeroUnspecifiedMeasureSpec', 'sPreserveMarginParamsInLayoutParamConversion'].includes(field.name) || field.type === 'I' && ['mPaddingLeft', 'mPaddingTop', 'mPaddingRight', 'mPaddingBottom', 'mLeft', 'mTop', 'mRight', 'mBottom', 'mMinWidth', 'mMinHeight', 'mMeasuredWidth', 'mMeasuredHeight', 'mLayoutDirection', 'mID'].includes(field.name) || field.type === 'Landroid/content/Context;' && field.name === 'mContext' || field.type === 'Landroid/view/ViewGroup$LayoutParams;' && field.name === 'mLayoutParams' || field.type === 'Landroid/view/ViewParent;' && field.name === 'mParent') return { ...field, owner: 'Landroid/view/View;', key: `Landroid/view/View;->${field.name}:${field.type}` };
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
      Object.defineProperty(view, 'padding', { enumerable: true, configurable: true, get: () => padding, set: value => { for (const edge of ['left', 'top', 'right', 'bottom']) padding[edge] = value?.[edge] || 0; view.userPaddingLeftInitial = padding.left; view.userPaddingRightInitial = padding.right; } });   // a whole padding is what setPadding / the XML / the background gave (View.mUserPaddingLeftInitial / RightInitial); a resolved padding (View.internalSetPadding: viewXmlAttributes.writePadding) and a subclass write single mPadding* fields over it
      for (const [property, name, type, initial] of [['context', 'mContext', 'Landroid/content/Context;', initialContext], ['minimumWidth', 'mMinWidth', 'I', minimumWidth], ['minimumHeight', 'mMinHeight', 'I', minimumHeight]]) { const key = `Landroid/view/View;->${name}:${type}`; Object.defineProperty(view, property, { enumerable: true, configurable: true, get: () => fields.get(key) ?? (type === 'I' ? 0 : null), set: value => runtime.storeField(fields, key, value) }); view[property] = initial; }
      // View.mID is the id itself: ViewStub's constructor assigns it directly (it calls View(Context), which reads no attribute). NO_ID is "no id".
      { const key = 'Landroid/view/View;->mID:I', initialId = view.androidId; Object.defineProperty(view, 'androidId', { enumerable: true, configurable: true, get: () => { const id = fields.get(key); return id === undefined || id === -1 ? undefined : id >>> 0; }, set: value => { if (value === undefined || value === null) fields.delete(key); else runtime.storeField(fields, key, value | 0); } }); if (initialId !== undefined) view.androidId = initialId; }
      // View.mParent, for the originals that read the field (AbsSeekBar and Gallery tell the parent not to intercept a drag): it is the view's parent whenever that is a View.
      if (READS_PARENT_FIELD.some(type => runtime.isSubtype(view.type, type))) { const key = 'Landroid/view/View;->mParent:Landroid/view/ViewParent;', initialParent = view.parent ?? null; Object.defineProperty(view, 'parent', { enumerable: true, configurable: true, get: () => fields.get(key) ?? null, set: value => { if (value === undefined || value === null) fields.delete(key); else runtime.storeField(fields, key, value); } }); view.parent = initialParent; }
      { const left = view.userPaddingLeftInitial, right = view.userPaddingRightInitial; view.padding = initialPadding; if (left !== undefined) view.userPaddingLeftInitial = left; if (right !== undefined) view.userPaddingRightInitial = right; }   // installing the accessors keeps the initial values a constructor pass already gave
      view.nativeFieldAccessors = true;
    }
    for (const edge of ['left', 'top', 'right', 'bottom']) runtime.storeField(fields, `Landroid/view/View;->mPadding${edge[0].toUpperCase() + edge.slice(1)}:I`, view.padding?.[edge] || 0);
    if (view.context) runtime.storeField(fields, 'Landroid/view/View;->mContext:Landroid/content/Context;', view.context);
    runtime.storeField(fields, 'Landroid/view/View;->mMinWidth:I', view.minimumWidth || 0); runtime.storeField(fields, 'Landroid/view/View;->mMinHeight:I', view.minimumHeight || 0);
  }
  /**
   * A resource lookup that fails as it fails on Android: Resources.NotFoundException with ResourcesImpl / Resources' message (android-13.0.0_r1: "Resource ID #0x7f..",
   * "String resource ID #0x..", "Resource ID #0x.. type #0x.. is not valid", ...), which the app may catch. That is what an id with no entry in a loaded package, an id with
   * no variant for the device configuration, a bag where a value is asked for and a value of the wrong type are. What the lab cannot model (an android framework resource
   * missing from the lab's framework data, a package that is not loaded, a cyclic chain, no configuration selector) stays an explicit lab error naming the reason.
   */
  resourceNotFound(runtime, id, resolved, message) {
    const hex = (Number(id) >>> 0).toString(16);
    if (resolved?.kind === 'unresolved' && !ANDROID_ABSENCE.has(resolved.absence)) error(`Resource 0x${hex}: ${resolved.reason || 'unresolved'}`, { kind: 'resource-unsupported', resourceId: Number(id) >>> 0 });
    runtime ??= this.vmRuntime;
    runtime.record(`RESOURCE Resources$NotFoundException: ${message}${resolved?.reason ? ` (${resolved.reason})` : resolved?.kind ? ` (a ${resolved.resourceType ? resolved.resourceType + ' ' : ''}${resolved.kind})` : ''}`);
    runtime.throwJava(RESOURCES_NOT_FOUND, message);
  }
  /** The value of resource `id` (references followed), of one of the `expected` kinds when given; otherwise Resources.NotFoundException with `message` (default ResourcesImpl.getValue's). */
  resource(id, expected, message = null, runtime = null, known = null) {   // known: the id's resolution when the caller already has it
    const hex = (Number(id) >>> 0).toString(16);
    if (!this.resources) error(`Resources are unavailable for ID 0x${hex}`, { kind: 'resource-unsupported', resourceId: id });
    const resolved = known ?? this.resources.resolve(id);
    if (resolved.kind === 'unresolved' || resolved.kind === 'bag') this.resourceNotFound(runtime, id, resolved, message ?? `Resource ID #0x${hex}`);
    if (expected && !expected.includes(resolved.kind)) { let leaf = resolved; while (leaf.resolved) leaf = leaf.resolved; this.resourceNotFound(runtime, id, leaf, message ?? `Resource ID #0x${hex} type #0x${(leaf.dataType ?? 0).toString(16)} is not valid`); }
    return resolved;
  }
  /**
   * Resources.getText(id) / getString(id) (android-13.0.0_r1): AssetManager.getResourceText gives a string value as it is and any other value coerced to text
   * (TypedValue.coerceToString: "42", "true", "#ff336699", "12.5dip"); nothing (no entry, a bag, @null) is NotFoundException("String resource ID #0x..").
   */
  stringResource(runtime, id) {
    const hex = (Number(id) >>> 0).toString(16), message = `String resource ID #0x${hex}`;
    if (!this.resources) error(`Resources are unavailable for ID 0x${hex}`, { kind: 'resource-unsupported', resourceId: id });
    let resolved = this.resources.resolve(id);
    if (resolved.kind === 'string') return resolved.value;
    if (resolved.kind === 'unresolved' || resolved.kind === 'bag') this.resourceNotFound(runtime, id, resolved, message);
    while (resolved.resolved) resolved = resolved.resolved;   // the value at the end of an alias chain
    if (resolved.kind === 'null' || !resolved.dataType) this.resourceNotFound(runtime, id, resolved, message);
    runtime ??= this.vmRuntime;
    const text = runtime.dispatch({ owner: 'Landroid/util/TypedValue;', name: 'coerceToString', parameters: ['I', 'I'], result: 'Ljava/lang/String;', signature: '(II)Ljava/lang/String;' }, [resolved.dataType, resolved.rawData | 0], 'static');
    if (text === null || text === undefined) this.resourceNotFound(runtime, id, resolved, message);
    return typeof text === 'string' ? text : runtime.stringCharacters(text);
  }
  /**
   * The compiled XML tree of resource `id` as ResourcesImpl reads one (loadXmlResourceParser for getLayout / getAnimation / getXml, loadDrawableForCookie, loadColorStateList):
   * no value or a value that is no file path is NotFoundException from xmlResourceCheck; a file path that names no XML file of the APK is NotFoundException("File <path> from
   * <what> resource ID #0x.."), `what` being "xml type layout" / "xml type anim" / "xml type xml", "drawable", "color state list". A file the lab could not parse stays its error.
   */
  xmlResource(runtime, id, what, layoutOnly = false) {
    const resolved = this.xmlResourceCheck(runtime, id);
    try { return layoutOnly ? this.resources.getLayout(id) : this.resources.getXml(id); }
    catch (failure) { if (!failure?.details?.absentFile) throw failure; this.resourceNotFound(runtime, id, resolved, `File ${resolved.value} from ${what} resource ID #0x${(Number(id) >>> 0).toString(16)}`); }
  }
  /** ResourcesImpl.loadXmlResourceParser's checks before an XML file is read (getLayout / getAnimation / getXml): the id has a value, and the value is a file path. */
  xmlResourceCheck(runtime, id) {
    const hex = (Number(id) >>> 0).toString(16);
    if (!this.resources) error(`Resources are unavailable for ID 0x${hex}`, { kind: 'resource-unsupported', resourceId: id });
    const resolved = this.resources.resolve(id);
    if (resolved.kind === 'unresolved' || resolved.kind === 'bag') this.resourceNotFound(runtime, id, resolved, `Resource ID #0x${hex}`);
    if (resolved.kind !== 'string') this.resourceNotFound(runtime, id, resolved, `Resource ID #0x${hex} type #0x${(resolved.dataType ?? 0).toString(16)} is not valid`);
    return resolved;
  }
  typedAttribute(attribute) {
    if (attribute.kind !== 'reference') return attribute;
    const value = attribute.resolved ?? this.resource(attribute.reference);
    if (value.kind === 'unresolved' || value.kind === 'bag') error(`XML attribute ${attribute.name} has unresolved resource 0x${attribute.reference.toString(16)}: ${value.reason || value.kind}`, { kind: 'resource-unsupported', resourceId: attribute.reference });
    return value;
  }
  /** An android: attribute of a layout tag that the lab did not apply (applyXMLAttributes default): counted per attribute and tag for the diagnostics summary, traced once each. */
  noteXmlAttributeNotApplied(runtime, name, tag, reason = null, type = null, origin = null) {
    const notes = this.xmlAttributesNotApplied ??= new Map(), key = `android:${name} on <${tag}>${origin ? ` (${origin})` : ''}`;
    const seen = notes.get(key) ?? 0;
    if (seen === 0 && notes.size >= 400) { if ((this.xmlAttributesNotAppliedDropped = (this.xmlAttributesNotAppliedDropped ?? 0) + 1) === 1) runtime.record('XML attributes not applied: more than 400 kinds (attribute and tag); the further ones are counted, not listed'); return; }   // bounded, never silent
    notes.set(key, seen + 1);
    if (seen !== 0) return;
    // What the diagnostics summary says about the attribute besides its name and tag: the class of the View that was built for the tag (a factory may build another class than
    // the tag names) and why the attribute was not applied, so that the gap can be found from the summary alone.
    const className = type ? type.slice(1, -1).replaceAll('/', '.') : null;
    (this.xmlAttributesNotAppliedDetails ??= new Map()).set(key, { className, reason: reason ?? null, origin: origin ?? null });
    runtime.record(`XML attribute not applied: ${key}${className ? ` [${className}]` : ''} (${reason ?? "the lab's View classes do not implement it yet"}; the screen is inflated without it)`);
  }
  /** Whether a failure is the lab's own explicit refusal of an attribute value (an APKError naming what is unsupported), as opposed to a Java exception of the app or the framework, a limit of the VM or a defect. */
  isAttributeRefusal(failure) {
    return failure?.name === 'APKError' && failure.details?.kind !== 'instruction-budget' && !/budget|heap|limit exceeded|aborted|cancell?ed/i.test(String(failure.message));
  }
  /**
   * Whether a failure of the lab names a widget class, a method or a system service the virtual device does not have. The rule about attributes (an android: attribute is
   * reported and never ends an inflation) covers attributes only: when a whole constructor stops at one of these it fails by name and is not run again (recoverViewConstruction).
   * Where one attribute is being applied on its own (a constructor pass), the missing setter is that attribute not being implemented, which is a report.
   */
  namesMissingCode(failure) {
    return failure?.name === 'APKError' && (failure.details?.kind === 'unsupported-widget' || /^Unsupported API\/method: |System service class \S+ is not installed/.test(String(failure.message)));
  }
  /** Whether a Java exception was thrown by code of the app (the method that threw is of a class the APK defines), as opposed to the framework's. */
  thrownByAppCode(runtime, failure) {
    if (failure?.name !== 'JavaException') return false;
    try { const owner = runtime.object(failure.value).stack?.[0]?.owner, cls = owner ? runtime.classes.get(owner) : null; return !!cls?.dex && !runtime.dex.bootDexes?.has(cls.dex); } catch { return false; }
  }
  /** How a report words a RuntimeException that applying an attribute's value threw: the exception Android's own code throws for it, which on a device ends the inflation. */
  javaRefusalReason(runtime, failure) {
    let type = 'java.lang.RuntimeException', message = ''; try { const object = runtime.object(failure.value); type = object.type.slice(1, -1).replaceAll('/', '.'); message = typeof object.message === 'string' ? object.message : object.message ? runtime.javaString(object.message) : ''; } catch { /* the wording only */ }
    return `applying the value throws ${type}${message ? `: ${String(message).replace(/\s+/g, ' ').slice(0, 140)}` : ''} (on a device this ends the inflation of the layout; the lab leaves the attribute out)`;
  }
  /** The attributes of a tag that are kept from every TypedArray read of it while the parser that met them is open (recoverViewConstruction); the parsed tree itself is shared between inflations. */
  withheldFor(node) { const entry = this.withheldAttributes?.get(node); return entry && !entry.owner.closed ? entry.set : null; }
  /**
   * LayoutInflater.createView: the constructor of a framework View class threw a RuntimeException while it read the tag. When leaving one android: attribute of the tag out
   * makes the same constructor succeed, that attribute's value is what it could not take: the View is built without it and the attribute is reported with the exception (the
   * owner's rule: an android: attribute never fails an inflation). When no single attribute explains the failure it is not about an attribute value, and it propagates as it was.
   * Only for framework classes (their constructors are the originals, or the lab's passes written from them): an app's own View constructor is run once, as on a device.
   */
  recoverViewConstruction(runtime, method, words, failure) {
    const CONTEXT = 'Landroid/content/Context;', ATTRS = 'Landroid/util/AttributeSet;';
    if (method.name !== '<init>' || method.parameters[0] !== CONTEXT || method.parameters[1] !== ATTRS || !/^L(?:android|com\/android\/internal)\//.test(method.owner)) return undefined;
    // A RuntimeException of the constructor, or the lab's own explicit refusal of something the value led to (a framework resource the virtual device does not have).
    const java = failure?.name === 'JavaException' && runtime.isSubtype(runtime.typeOf(failure.value), 'Ljava/lang/RuntimeException;');
    if (!java && !(this.isAttributeRefusal(failure) && !this.namesMissingCode(failure)) || !runtime.isSubtype(method.owner, 'Landroid/view/View;')) return undefined;
    if (java && this.thrownByAppCode(runtime, failure)) return undefined;   // an exception of the app's own code (a method of its subclass that the constructor called) is the app's: as on a device
    const attrs = words[2]; if (!attrs?.ref) return undefined;
    const node = runtime.object(attrs).node; if (!node?.attributes || this.recoveringView) return undefined;
    const owner = runtime.object(attrs), held = this.withheldAttributes ??= new WeakMap(), before = this.withheldFor(node) ?? new Set();
    const candidates = node.attributes.filter(attribute => attribute.resourceId && attribute.namespace === 'http://schemas.android.com/apk/res/android' && !before.has(attribute) && !attribute.name?.startsWith('layout_')).slice(0, RECOVERY_CANDIDATES);   // a layout_* attribute is the parent's, no View constructor reads it
    this.recoveringView = true;
    try {
      for (const attribute of candidates) {
        held.set(node, { owner, set: new Set([...before, attribute]) });
        const receiver = runtime.allocate(method.owner);
        try { runtime.dispatch(method, [receiver, ...words.slice(1)], 'direct'); }
        catch (retry) { if (retry?.name !== 'JavaException' && retry?.name !== 'APKError') throw retry; continue; }
        this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name, `the constructor of ${method.owner.slice(1, -1).replaceAll('/', '.')} fails with this value: ${java ? this.javaRefusalReason(runtime, failure) : `${this.refusalReason(failure)} (the lab builds the View without the attribute)`}`, method.owner);
        return receiver;
      }
      if (before.size) held.set(node, { owner, set: before }); else held.delete(node);
      return undefined;
    } finally { this.recoveringView = false; }
  }
  /**
   * ViewGroup.addViewInner: the parent's checkLayoutParams threw a RuntimeException for LayoutParams that were read from the child's tag (GridLayout refuses a negative
   * layout_row or layout_column, which aapt2 compiles). As for a constructor (recoverViewConstruction): when the LayoutParams read again without one layout_* attribute of the
   * tag are accepted, that attribute's value is what the parent could not take; the child is added with those LayoutParams and the attribute is reported with the exception.
   * When no single attribute explains it, or the exception is of the app's own code, it propagates as it was.
   */
  recoverLayoutParams(runtime, group, params, failure) {
    if (failure?.name !== 'JavaException' || this.recoveringParams || !runtime.isSubtype(runtime.typeOf(failure.value), 'Ljava/lang/RuntimeException;') || this.thrownByAppCode(runtime, failure)) return undefined;
    const source = this.layoutParamsSource?.get(runtime.object(params)); if (!source || source.parser.closed || !this.xmlHost?.isLayoutNode(source.node)) return undefined;
    const node = source.node, held = this.withheldAttributes ??= new WeakMap(), before = this.withheldFor(node) ?? new Set(), ATTRS = 'Landroid/util/AttributeSet;';
    const candidates = node.attributes.filter(attribute => attribute.resourceId && attribute.namespace === 'http://schemas.android.com/apk/res/android' && attribute.name?.startsWith('layout_') && !before.has(attribute)).slice(0, RECOVERY_CANDIDATES);
    const attrs = this.viewXmlAttributes.kit.attributeSet(runtime, node);   // the parser has moved on from the tag: the same tag, as an AttributeSet of its own
    this.recoveringParams = true;
    try {
      for (const attribute of candidates) {
        held.set(node, { owner: source.parser, set: new Set([...before, attribute]) });
        let again;
        try {
          again = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateLayoutParams', signature: `(${ATTRS})${LAYOUT_PARAMS}`, parameters: [ATTRS], result: LAYOUT_PARAMS }, [group, attrs], 'virtual');
          if (!again?.ref || !runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'checkLayoutParams', signature: `(${LAYOUT_PARAMS})Z`, parameters: [LAYOUT_PARAMS], result: 'Z' }, [group, again], 'virtual')) continue;
        } catch (retry) { if (retry?.name !== 'JavaException') throw retry; continue; }
        this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name, `${runtime.typeOf(group).slice(1, -1).replaceAll('/', '.')} refuses the LayoutParams with this value: ${this.javaRefusalReason(runtime, failure)}`);
        return again;
      }
      if (before.size) held.set(node, { owner: source.parser, set: before }); else held.delete(node);
      return undefined;
    } finally { this.recoveringParams = false; }
  }
  /** A lab failure as the reason of a report: without the chain of methods it passed through ("Lowner;->name(..) [file.dex] at PC 0x..: "), which would use up the reason. */
  refusalReason(failure) { return String(failure?.message ?? failure).replace(/\s+/g, ' ').replace(/^(?:L[^ ]+ \[[^\]]*\] at PC 0x[\da-f]+: )+/i, '').replace(/^Android platform: /, '').slice(0, 200); }
  /** Context.getApplicationInfo() of the Context a View or LayoutParams is built with: its targetSdkVersion and ApplicationInfo.hasRtlSupport (the Context may belong to a second package). */
  contextApplication(runtime, context) {
    const fallback = () => { const app = this.manifest?.application ?? {}, rtl = app.supportsRtl; return { targetSdk: Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1), supportsRtl: rtl === true || rtl === 'true' || (Number.isInteger(rtl) && rtl !== 0) }; };
    if (nullish(context)) return fallback();
    let info; try { info = runtime.dispatch({ owner: 'Landroid/content/Context;', name: 'getApplicationInfo', signature: `()${APPLICATION_INFO}`, parameters: [], result: APPLICATION_INFO }, [context], 'virtual'); } catch (failure) { if (!(failure instanceof APKError)) throw failure; return fallback(); }
    if (nullish(info)) return fallback();
    const fields = runtime.object(info).fields;
    return { targetSdk: Number(fields.get(`${APPLICATION_INFO}->targetSdkVersion:I`) ?? 0), supportsRtl: (Number(fields.get(`${APPLICATION_INFO}->flags:I`) ?? 0) & 0x400000) !== 0 };
  }
  targetSdkOf(runtime, context) { return this.contextApplication(runtime, context).targetSdk; }
  /** A resource lookup that found nothing where Android would also find nothing (a style that cannot be read, a ?attr the theme does not define, a reference to a package that is not loaded): counted for the diagnostics summary, traced once each. The value is read without it, as AssetManager2 does. */
  noteResourceUnresolved(runtime, what, reason) {
    const notes = this.resourcesUnresolved ??= new Map(), seen = notes.get(what)?.count ?? 0; if (seen === 0 && notes.size >= 400) return;
    notes.set(what, { count: seen + 1, reason });
    if (seen === 0) runtime.record(`Resource not resolved: ${what} (${reason})`);
  }
  /** A framework behaviour the lab does not implement and tolerates (the screen goes on without it): recorded once per key in the trace and listed in the diagnostics summary. */
  noteFrameworkGap(runtime, key, text) {
    const notes = this.frameworkGaps ??= new Map(), seen = notes.get(key)?.count ?? 0; if (seen === 0 && notes.size >= 200) return;
    notes.set(key, { count: seen + 1, text });
    if (seen === 0) runtime.record(`Not implemented: ${text}`);
  }
  /** Whether the attribute's value is a reference to a style / array / plurals resource (a bag), which has no scalar value. */
  isBagReference(attribute) {
    if (attribute.kind !== 'reference' || !attribute.reference) return false;
    let entry = attribute.resolved ?? this.resources?.resolve(attribute.reference); for (let guard = 0; entry?.resolved && guard < 20; guard++) entry = entry.resolved;
    return entry?.kind === 'bag';
  }
  /**
   * An android: attribute that no case of the lab's attribute pass applies (or whose value a case could not take: `reason`).
   *  - An attribute of the styleable of an original (DEX) widget class in the view's ancestry (AbsListView, ListView, Toolbar, ...) is read by that class's own constructor.
   *  - A layout_* attribute is never the View's: the parent's generateLayoutParams(AttributeSet) reads the ones its LayoutParams class knows and ignores the rest (a
   *    layout_alignParentTop under a parent that is not a RelativeLayout does nothing on Android).
   *  - An attribute a constructor pass has read (`handled`: the View part of a name another class's styleable shares, android:backgroundTint) is applied.
   *  - An attribute that came from a style (the default style or style="") and belongs to no styleable of the view's classes is another class's: styles are shared between
   *    classes, and no constructor of this View reads it.
   *  - Anything else is an attribute the lab's View classes do not apply yet. On Android a View's constructor reads the attributes of its own styleables and ignores every other
   *    one, so the inflation never fails for an attribute. The lab keeps inflating too and reports it (owner's decision of 2026-11-17, CLAUDE.md): the attribute, the tag and how
   *    often, with the reason and, for an attribute a style gave, where it came from ("style" or "default style"), in the trace once and in the diagnostics summary, never
   *    silently. What it would have changed on a device (a look, a limit) is not applied.
   */
  leaveAttributeToClass(runtime, type, attribute, node, handled = null, reason = null) {
    if (this.ownedByOriginalClass(runtime, type, attribute)) {
      if (!attribute.fromStyle) { const gap = ORIGINAL_ATTRIBUTES_WITHOUT_PAGE_EFFECT.find(entry => entry.names.includes(attribute.name) && runtime.isSubtype(type, entry.owner)); if (gap) this.viewXmlAttributes?.kit.noteNoEffect(runtime, attribute.name, node.name, gap.reason); }
      return;
    }
    if (attribute.name.startsWith('layout_') || handled?.has(attribute.name)) return;
    if (attribute.fromStyle && !this.ownedByAncestryStyleable(runtime, type, attribute)) return;
    // An attribute of a host container that only the original class applies (LinearLayout's weight sum, dividers and baseline alignment, FrameLayout's measureAllChildren):
    // the loader brings the layouts profile for an APK whose layouts or styles give one (src/apk-loader.js), so this is a run with the profile switched off.
    const profileOwner = !reason && LAYOUTS_PROFILE_ATTRIBUTES[attribute.name]?.owner;
    if (profileOwner && runtime.isSubtype(type, `Landroid/widget/${profileOwner};`) && !runtime.classes.has(`Landroid/widget/${profileOwner};`)) reason = `it is applied by the original android.widget.${profileOwner}, a class of the layouts profile, which is not loaded for this APK (the loader brings the profile for an APK whose layouts or styles give the attribute; this run has it switched off)`;
    // An attribute Android 13 does not have (an APK compiled against a newer platform carries the attributes of that platform; a device of API 33 ignores what it does not know).
    if (!reason && attribute.resourceId >>> 16 === 0x0101 && attribute.resourceId >>> 0 > ANDROID_13_LAST_ATTRIBUTE_ID) {
      const id = `0x${(attribute.resourceId >>> 0).toString(16).padStart(8, '0')}`, known = !!this.resources?.frameworkTable?.entries?.has(attribute.resourceId >>> 0);   // the table is the SDK's of a later release: it names the newer attributes
      reason = known ? `the attribute (${id}) was added to Android after API 33: Android 13, the release of the virtual device, does not have it and ignores it`
        : `no Android release the virtual device knows declares attribute ${id}: a device ignores an attribute it does not know, and so does the lab`;
    }
    // An attribute the tag gives that no framework class of the View declares (android:adjustViewBounds on a class that is not an ImageView): no framework constructor reads
    // it, so a device ignores it too; a class of the app that declares it in its own styleable reads it in its own code, which runs here as on a device.
    if (!reason && !attribute.fromStyle && attribute.resourceId && !this.ownedByAncestryStyleable(runtime, type, attribute)) {
      const framework = (() => { for (let current = type, guard = 0; current && guard < 32; current = runtime.parent(current), guard++) if (current.startsWith('Landroid/') || current.startsWith('Lcom/android/internal/')) return current.slice(1, -1).replaceAll('/', '.'); return 'android.view.View'; })();
      reason = `no framework class of this View reads it (it is in no styleable of ${framework} or the classes above it): Android ignores it on this tag too; only a class of the app that declares it in its own styleable reads it, in its own code`;
    }
    this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name, reason, type, attribute.fromStyle ?? null);
  }
  /**
   * Whether the attribute belongs to R.styleable.<Class> of a class in the view's ancestry, original or host-modeled: the R.styleable arrays of the framework DEX, and for the
   * classes the lab models in its hosts the memberships of the pinned attrs.xml (src/host-styleables.js).
   */
  ownedByAncestryStyleable(runtime, type, attribute) {
    for (let current = type, guard = 0; current && guard < 32; current = runtime.parent(current), guard++) {
      if (!current.startsWith('Landroid/') && !current.startsWith('Lcom/android/internal/')) continue;
      const simple = current.slice(current.lastIndexOf('/') + 1, -1).split('$').pop();
      if (HOST_STYLEABLES[simple]?.includes(attribute.name)) return true;
      if (!attribute.resourceId) continue;
      let array; try { array = runtime.readStatic({ owner: 'Lcom/android/internal/R$styleable;', name: simple, type: '[I', key: `Lcom/android/internal/R$styleable;->${simple}:[I` }); } catch (failure) { if (failure?.name !== 'APKError' && failure?.name !== 'JavaException') throw failure; continue; }   // a class without a styleable of its own
      if (array && runtime.array(array).elements.includes(attribute.resourceId | 0)) return true;
    }
    return false;
  }
  /** Whether the attribute belongs to R.styleable.<Class> of a class in the view's ancestry that is original framework bytecode rather than a host-modeled class. */
  ownedByOriginalClass(runtime, type, attribute) {
    if (!attribute.resourceId) return false;
    for (let current = type, guard = 0; current && guard < 32; current = runtime.parent(current), guard++) {
      if (!runtime.classes.get(current) || !current.startsWith('Landroid/') && !current.startsWith('Lcom/android/internal/')) continue;
      const simple = current.slice(current.lastIndexOf('/') + 1, -1).split('$').pop();
      // Besides R.styleable.<Class>, the styleables the class's constructor reads from the same AttributeSet under another name: AbsSeekBar reads SeekBar; Spinner hands the set to its
      // dropdown (ListPopupWindow, PopupWindow: dropDownVerticalOffset, popupBackground, overlapAnchor, ...).
      for (const name of [simple, ...(ORIGINAL_CLASS_STYLEABLES[simple] ?? [])]) {
        let array; try { array = runtime.readStatic({ owner: 'Lcom/android/internal/R$styleable;', name, type: '[I', key: `Lcom/android/internal/R$styleable;->${name}:[I` }); } catch (failure) { if (failure?.name !== 'APKError' && failure?.name !== 'JavaException') throw failure; continue; }   // a class without a styleable of its own
        if (array && runtime.array(array).elements.includes(attribute.resourceId | 0)) return true;
      }
    }
    return false;
  }
  /**
   * The attributes of ImageView and ProgressBar that their constructors hand to a setter of the class (android-13.0.0_r1 ImageView.java, ProgressBar.java), read as the
   * constructor reads them: through a TypedArray over the one attribute (the tag's own value or the one its style gives). Returns whether the attribute was one of them.
   */
  widgetAttribute(runtime, self, type, node, context, attribute) {
    const IMAGE = 'Landroid/widget/ImageView;', BAR = 'Landroid/widget/ProgressBar;', BLEND = 'Landroid/graphics/BlendMode;', TINT = 'Landroid/content/res/ColorStateList;', name = attribute.name, kit = this.viewXmlAttributes?.kit;
    const image = runtime.isSubtype(type, IMAGE) && ['adjustViewBounds', 'maxWidth', 'maxHeight', 'baseline', 'baselineAlignBottom', 'cropToPadding', 'tint', 'tintMode', 'drawableAlpha'].includes(name);
    const tint = !image && runtime.isSubtype(type, BAR) ? /^(progress|progressBackground|secondaryProgress|indeterminate)Tint(Mode)?$/.exec(name) : null;
    if (!(image || tint) || !kit || !runtime.classes.has('Landroid/content/res/TypedArray;') || !this.styleBackend) return false;
    const list = kit.styleable(runtime, `one:${name}`, [name]); if (!list.ids.length) return false;
    const ids = runtime.newArray('[I', 1); runtime.object(ids).elements = [...list.ids];
    // The one-attribute tag is read with the rule of its layout: a value the getter cannot read is left out and reported (AndroidStyleBackend.unreadable).
    const single = { name: node.name, attributes: [attribute] }; if (this.xmlHost.isLayoutNode(node) && !attribute.fromStyle) this.xmlHost.layoutNodes.add(single);
    const attrs = kit.attributeSet(runtime, single), a = kit.reader(runtime, this.styleBackend.obtain(runtime, this.styleBackend.theme(runtime, context), attrs, ids, 0, 0), list);
    const set = (owner, method, signature, values) => kit.call(runtime, 'virtual', owner, method, signature, [self, ...values]);
    try {
      if (!a.has(name)) return true;
      if (tint) {   // ProgressBar: mProgressTintInfo, then applyProgressTints / applyIndeterminateTint
        const part = tint[1][0].toUpperCase() + tint[1].slice(1);
        if (tint[2]) set(BAR, `set${part}TintBlendMode`, `(${BLEND})V`, [kit.parseBlendMode(runtime, a.int(name, -1))]);
        else { const colors = a.colors(name); set(BAR, `set${part}TintList`, `(${TINT})V`, [colors]); if (name === 'progressTint') runtime.object(self).progressTint = kit.colorText(kit.call(runtime, 'virtual', TINT, 'getDefaultColor', '()I', [colors])); }   // the page's progress colour in the flow mode
        return true;
      }
      switch (name) {
        case 'adjustViewBounds': {   // setAdjustViewBounds(true) sets FIT_CENTER, and android:scaleType is applied after it in the constructor: a scale type the XML gave stays
          const SCALE = 'Landroid/widget/ImageView$ScaleType;', given = runtime.object(self).imageScaleType != null ? set(IMAGE, 'getScaleType', `()${SCALE}`, []) : null;
          set(IMAGE, 'setAdjustViewBounds', '(Z)V', [a.bool(name, false) ? 1 : 0]); if (given) set(IMAGE, 'setScaleType', `(${SCALE})V`, [given]); break;
        }
        case 'maxWidth': set(IMAGE, 'setMaxWidth', '(I)V', [a.size(name, 0x7fffffff)]); break;
        case 'maxHeight': set(IMAGE, 'setMaxHeight', '(I)V', [a.size(name, 0x7fffffff)]); break;
        case 'baseline': set(IMAGE, 'setBaseline', '(I)V', [a.size(name, -1)]); break;
        case 'baselineAlignBottom': set(IMAGE, 'setBaselineAlignBottom', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
        case 'cropToPadding': set(IMAGE, 'setCropToPadding', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
        case 'tint':   // "Prior to L, this attribute would always set a color filter with blending mode SRC_ATOP. Preserve that default behavior."
          if (kit.call(runtime, 'virtual', IMAGE, 'getImageTintBlendMode', `()${BLEND}`, [self]) == null) set(IMAGE, 'setImageTintBlendMode', `(${BLEND})V`, [runtime.readStatic({ owner: BLEND, name: 'SRC_ATOP', type: BLEND, key: `${BLEND}->SRC_ATOP:${BLEND}` })]);
          set(IMAGE, 'setImageTintList', `(${TINT})V`, [a.colors(name)]); break;
        case 'tintMode': { const mode = kit.parseBlendMode(runtime, a.int(name, -1)); if (mode != null) set(IMAGE, 'setImageTintBlendMode', `(${BLEND})V`, [mode]); break; }
        case 'drawableAlpha': { const alpha = a.int(name, 255); if (alpha !== 255) set(IMAGE, 'setImageAlpha', '(I)V', [alpha]); break; }
      }
      return true;
    } finally { a.recycle(); }
  }
  /**
   * The android: attributes a tag's style="" and the View's default style give the classes without a constructor pass of their own (ImageView, ProgressBar, the host
   * LinearLayout / FrameLayout / ScrollView), as attribute records of the tag. Android reads the tag, its style and the default style through one TypedArray
   * (Resources.Theme.obtainStyledAttributes: XML attribute > style="" > the default style, which is theme -> defStyleAttr, or defStyleRes when that attribute is 0 or absent
   * from the theme), so what a class reads inline it reads from the styles too. The constructor passes (view-xml-attributes.js, textview-xml-attributes.js) read their own
   * styleables that way through the style backend; this gives the rest to the cases of inflate(), each record marked with where it came from (`fromStyle`: "style" or
   * "default style"). The default style is the one the constructor was called with, read where the passes read it (where the VM measures and draws the View itself).
   * Left out: what the tag gives itself, what a constructor pass or an original class reads from the AttributeSet on its own (`handled`, R.styleable of an original class),
   * the LayoutParams attributes (their own pass reads the style), and for a ProgressBar the items a framework style contributes (android:style/Widget.*ProgressBar*: the stock
   * look of the widget, which the lab's model of it draws itself). A style that cannot be read is no style (AssetManager2::GetBag fails, ApplyStyle goes on): the pass that
   * read it through the style backend has reported it.
   */
  styleAttributes(runtime, node, context, type, handled, view = null) {
    const ANDROID = 'http://schemas.android.com/apk/res/android', style = node.attributes.find(attribute => attribute.namespace === null && attribute.name === 'style'), table = this.resources?.table;
    if (!this.viewXmlAttributes || !this.styleBackend || !table?.resolveBag || !context) return [];
    const styled = !!runtime.skia && !!this.resources.frameworkXml, defStyleAttr = styled && view?.defStyleExplicit ? view.defStyleAttr | 0 : 0, defStyleRes = styled ? (view?.defStyleRes ?? 0) | 0 : 0;
    if (!style && !defStyleAttr && !defStyleRes) return [];
    const theme = runtime.object(this.styleBackend.theme(runtime, context)).themeValues;
    const themed = attr => { const found = table.getThemeAttribute(theme, attr >>> 0, false); return found?.value.kind === 'reference' && found.value.reference ? found.value.reference >>> 0 : 0; };   // ApplyStyle: a TYPE_REFERENCE names the style
    const styleId = !style ? 0 : style.kind === 'attribute' ? themed(style.reference) : style.kind === 'reference' ? style.reference >>> 0 : 0;
    const defaultId = (defStyleAttr ? themed(defStyleAttr) : 0) || defStyleRes >>> 0;
    if (!styleId && !defaultId) return [];
    const bag = id => { try { return table.resolveBag(id); } catch (failure) { if (failure?.name !== 'AndroidResourceError') throw failure; return []; } };
    const inline = new Set(node.attributes.filter(attribute => attribute.namespace === ANDROID).map(attribute => attribute.name)), given = new Map(), stockLook = runtime.isSubtype(type, 'Landroid/widget/ProgressBar;');
    const add = (id, origin) => {
      for (const [attributeId, value] of bag(id)) {
        if ((attributeId >>> 24) !== 0x01) continue;   // an attribute of the app or a library: its own View class reads it
        const name = this.viewXmlAttributes.kit.attributeName(attributeId >>> 0); if (!name) continue;
        given.delete(name);   // the style="" value of an attribute hides the default style's, whatever becomes of it below
        if (stockLook && ((value.sourceResourceId ?? 0) >>> 24) === 0x01) continue;
        if (inline.has(name) || handled?.has(name) || name.startsWith('layout_') || name === 'id' || name === 'textAppearance' || name === 'theme') continue;
        const attribute = { ...value, name, namespace: ANDROID, resourceId: attributeId >>> 0, fromStyle: origin };
        if (!this.ownedByOriginalClass(runtime, type, attribute)) given.set(name, attribute);
      }
    };
    if (defaultId) add(defaultId, 'default style');
    if (styleId) add(styleId, 'style');
    return [...given.values()];
  }
  /**
   * A View built in code with a default style (new ImageButton(context, null, 0, style), a constructor that passes defStyleAttr): the constructor passes have read their
   * styleables; what the default style gives the other classes goes through the cases of inflate() as the attributes of a tag without attributes (styleAttributes).
   */
  applyDefaultStyleInCode(runtime, receiver) {
    const view = runtime.object(receiver);
    if (!view.defStyleExplicit || !(view.defStyleAttr || view.defStyleRes) || !view.viewAttributesHandled || view.viewAttributesNode) return;
    const node = { name: view.type.slice(view.type.lastIndexOf('/') + 1, -1), attributes: [], children: [] }, previousTag = view.xmlTag;
    if (!this.styleAttributes(runtime, node, view.context, view.type, view.viewAttributesHandled, view).length) return;
    view.viewAttributesNode = node;   // the passes have run for this View: inflate() only applies the rest
    try { this.inflate(runtime, node, view.context, 0, { existing: receiver, applyOnly: true }); }
    finally { view.viewAttributesNode = null; view.appliedNode = null; view.xmlTag = previousTag; }
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
    view.max ??= 100; view.progress ??= 0; view.checked ??= false; view.visibility ??= 0; view.context = context; this.tagPackageView(runtime, view, context); view.enabled ??= true; view.xmlTag = node.name; view.padding ??= { left: 0, top: 0, right: 0, bottom: 0 };
    // The View and ViewGroup constructor passes (view-xml-attributes.js): every attribute of R.styleable.View / ViewGroup, from the tag, its style="" and the default style. A View built
    // through its constructor has run them already for this node; the loop below applies the attributes of the other classes and skips the ones those passes own.
    if (view.appliedNode !== node && view.viewAttributesNode !== node) this.viewXmlAttributes?.construct(runtime, value, node, context);
    const constructed = view.viewAttributesNode === node ? view.viewAttributesExclusive : null, constructedAll = view.viewAttributesNode === node ? view.viewAttributesHandled : null;
    // With the constructor passes run (they read the style and the default style for their own styleables), what those styles give the other classes (ImageView, ProgressBar) goes
    // through the same cases as the tag's own attributes, under them.
    const styleGiven = view.appliedNode !== node && constructedAll ? this.styleAttributes(runtime, node, context, type, constructedAll, view) : [];
    if (view.appliedNode !== node) for (const attribute of styleGiven.length ? [...styleGiven, ...node.attributes] : node.attributes) {
      this.inflateContext = context;
      if (attribute.namespace === null && attribute.name === 'style' && type === names.ProgressBar && attribute.kind === 'attribute' && attribute.reference === 16842872) { view.progressStyle = 'horizontal'; continue; }
      // Other namespaces belong to subclass DEX constructors, not the framework View attributes.
      if (attribute.namespace !== 'http://schemas.android.com/apk/res/android') continue;
      // View(Context, AttributeSet): mID = a.getResourceId(R.styleable.View_id, NO_ID), which answers NO_ID for a value that is not a reference. Said, since a layout cannot be compiled that way.
      if (attribute.name === 'id') { if (attribute.kind !== 'reference') { if (!this.withheldFor(node)?.has(attribute)) this.noteXmlAttributeNotApplied(runtime, 'id', node.name, 'the value is not a resource reference: TypedArray.getResourceId reads no id from it and the View has none (View.NO_ID)', type); continue; } view.androidId = attribute.reference; continue; }
      // android:textAppearance names a style (a bag of attributes), not a scalar: TextView's size, colour and typeface read that style where the text style is resolved
      // (applyStyledTextSize, the canvas text style lookups), so it is not typed here; typing it failed with "unresolved resource: Bag retained".
      if (attribute.name === 'textAppearance') continue;
      if (constructed?.has(attribute.name)) continue;   // applied by the View / ViewGroup constructor pass
      if (attribute.name === 'theme') continue;   // android:theme names a style (a bag): LayoutInflater.createViewFromTag wraps the Context with it, View never reads it
      // The value as a scalar. A reference to a style or an array (a bag) has none: the class that owns such an attribute reads it from the AttributeSet itself (an original
      // constructor, a constructor pass), so it only matters when a case below wants the scalar, and then the attribute is reported, not thrown.
      // android:entries, android:titleTextAppearance, android:popupTheme: known to be a bag without typing it.
      if (this.isBagReference(attribute)) { this.leaveAttributeToClass(runtime, type, attribute, node, constructedAll, 'its value is a style or an array, which only the class that owns the attribute reads'); continue; }
      let typed;
      try { typed = attribute.kind === 'attribute' ? this.styleBackend.resolved(attribute, runtime.object(this.styleBackend.theme(runtime, context)).themeValues) : this.typedAttribute(attribute); }
      catch (failure) {
        if (!this.isAttributeRefusal(failure)) throw failure;
        this.leaveAttributeToClass(runtime, type, attribute, node, constructedAll, this.refusalReason(failure));
        continue;
      }
      // An android: attribute never fails the inflation (CLAUDE.md): a case that refuses the value (an explicit error of the lab) reports the attribute and the tag is inflated without it.
      try { if (this.widgetAttribute(runtime, value, type, node, context, attribute)) continue; switch (attribute.name) {
        case 'layout_width': view.layoutWidth = this.dimension(attribute, runtime); break;
        case 'layout_height': view.layoutHeight = this.dimension(attribute, runtime); break;
        case 'layout': case 'inflatedId': case 'name': if (!runtime.classes.has(type)) error(`XML ${attribute.name} requires its actual View subclass DEX`); break; // ViewStub/custom constructor consumes these through original TypedArray.
        case 'tag': view.tag = typed.value; break;
        case 'fitsSystemWindows': view.fitsSystemWindows = !!typed.value; break; // VM content viewport excludes system bars; modeled system insets are zero.
        case 'fillViewport': view.fillViewport = !!typed.value; break;
        case 'clipChildren': case 'clipToPadding': if (!runtime.isSubtype(type, 'Landroid/view/ViewGroup;')) break; if (typed.kind !== 'boolean') error(`XML ${attribute.name} requires a boolean on ViewGroup`); view[attribute.name] = !!typed.value; break;
        case 'textStyle': view.textStyle = typed.value; break;
        case 'textAllCaps': view.textAllCaps = !!typed.value;   // TextView.applyTextAppearance: all caps is a TransformationMethod (the displayed text changes, getText() does not); an explicit false overrides the style's
          if (runtime.isSubtype(type, 'Landroid/widget/TextView;') && runtime.classes.has('Landroid/text/method/AllCapsTransformationMethod;') && (typed.value || view.transformationMethod && runtime.object(view.transformationMethod).type === 'Landroid/text/method/AllCapsTransformationMethod;')) runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'setAllCaps', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [value, typed.value ? 1 : 0], 'virtual');
          break;
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
        case 'checked':   // CompoundButton_checked is the host's; any other class with the attribute (CheckedTextView) reads it in its own constructor, and View's drawable state must not see it
          if (runtime.isSubtype(type, 'Landroid/widget/CompoundButton;')) view.checked = !!typed.value; else if (!this.ownedByOriginalClass(runtime, type, attribute)) this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name);
          break;
        case 'progress': view.progress = typed.value; break;
        case 'max': view.max = typed.value; break;
        case 'min': if (!runtime.isSubtype(type, 'Landroid/widget/ProgressBar;')) error('XML min requires a ProgressBar'); view.xmlMin = typed.value; break;
        case 'secondaryProgress': view.xmlSecondary = typed.value; break;
        case 'indeterminate': view.indeterminate = !!typed.value; break;
        case 'visibility': view.visibility = [0, 4, 8][typed.value] ?? 0; break;   // View(Context, AttributeSet): the attribute is the enum index (visible, invisible, gone), mapped through VISIBILITY_FLAGS to View.VISIBLE / INVISIBLE / GONE
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
        case 'layoutDirection': if (![0, 2, 3].includes(typed.value)) { this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name, 'right-to-left layout needs the styled-attribute path (the framework TypedArray), which this run does not have'); break; } view.layoutDirectionAttribute = typed.value; break;
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
        // View(Context, AttributeSet): focusable is a boolean or "auto" (FOCUSABLE_AUTO = 0x10); focusableInTouchMode, clickable and longClickable are booleans; each goes through the View setter.
        case 'focusable': { const mode = typed.kind === 'boolean' ? (typed.value ? 1 : 0) : typed.value | 0; if (![0, 1, 16].includes(mode)) error('XML focusable must be a boolean or "auto"'); runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setFocusable', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, mode], 'virtual'); break; }
        case 'focusableInTouchMode': case 'clickable': case 'longClickable': { if (typed.kind !== 'boolean') error(`XML ${attribute.name} must resolve to a boolean`); const setter = { focusableInTouchMode: 'setFocusableInTouchMode', clickable: 'setClickable', longClickable: 'setLongClickable' }[attribute.name]; runtime.dispatch({ owner: 'Landroid/view/View;', name: setter, signature: '(Z)V', parameters: ['Z'], result: 'V' }, [value, typed.value ? 1 : 0], 'virtual'); break; }
        // View(Context, AttributeSet) flags read by the original constructor and applied through the View API (android-13.0.0_r1 View.java): soundEffectsEnabled, hapticFeedbackEnabled,
        // saveEnabled and defaultFocusHighlightEnabled default to true; the others to false. forceDarkAllowed goes to the RenderNode there, through View.setForceDarkAllowed here.
        case 'soundEffectsEnabled': case 'hapticFeedbackEnabled': case 'saveEnabled': case 'keepScreenOn': case 'filterTouchesWhenObscured': case 'duplicateParentState': case 'screenReaderFocusable':
        case 'defaultFocusHighlightEnabled': case 'forceDarkAllowed': case 'nestedScrollingEnabled': case 'isScrollContainer': {
          if (typed.kind !== 'boolean') error(`XML ${attribute.name} must resolve to a boolean`);
          const setter = { soundEffectsEnabled: 'setSoundEffectsEnabled', hapticFeedbackEnabled: 'setHapticFeedbackEnabled', saveEnabled: 'setSaveEnabled', keepScreenOn: 'setKeepScreenOn', filterTouchesWhenObscured: 'setFilterTouchesWhenObscured', duplicateParentState: 'setDuplicateParentStateEnabled', screenReaderFocusable: 'setScreenReaderFocusable', defaultFocusHighlightEnabled: 'setDefaultFocusHighlightEnabled', forceDarkAllowed: 'setForceDarkAllowed', nestedScrollingEnabled: 'setNestedScrollingEnabled', isScrollContainer: 'setScrollContainer' }[attribute.name];
          if (attribute.name === 'isScrollContainer' && !typed.value) break;   // View: only android:isScrollContainer="true" calls setScrollContainer(true)
          runtime.dispatch({ owner: 'Landroid/view/View;', name: setter, signature: '(Z)V', parameters: ['Z'], result: 'V' }, [value, typed.value ? 1 : 0], 'virtual'); break;
        }
        case 'importantForAccessibility': runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setImportantForAccessibility', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, typed.value | 0], 'virtual'); break;
        case 'tooltipText': { if (!['string', 'null'].includes(typed.kind)) error('XML tooltipText must resolve to a string'); runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setTooltipText', signature: '(Ljava/lang/CharSequence;)V', parameters: ['Ljava/lang/CharSequence;'], result: 'V' }, [value, typed.value ?? null], 'virtual'); break; }
        case 'fadingEdge': {   // View(Context, AttributeSet): "Ignore the attribute starting with ICS" (targetSdk >= 14; android:requiresFadingEdge replaced it). Older apps would get fading edges, which the lab does not draw: reported.
          if (this.targetSdkOf(runtime, context) < 14) this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name, 'fading edges are not drawn', type, attribute.fromStyle ?? null);
          break;
        }
        case 'theme': break;   // android:theme on a tag is LayoutInflater's: createViewFromTag wraps the context in a ContextThemeWrapper before the View is built (the original AOSP inflater does); View's constructor never reads it
        case 'keyboardNavigationCluster': if (typed.kind !== 'boolean') error('XML keyboardNavigationCluster must resolve to a boolean');   // View(Context, AttributeSet): R.styleable.View_keyboardNavigationCluster
          runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setKeyboardNavigationCluster', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [value, typed.value ? 1 : 0], 'virtual'); break;
        case 'maxLength': {   // TextView(Context, AttributeSet, ...): R.styleable.TextView_maxLength >= 0 -> setFilters(new InputFilter[] { new InputFilter.LengthFilter(maxLength) })
          if (!runtime.isSubtype(type, 'Landroid/widget/TextView;')) break;
          if (!Number.isInteger(typed.value)) error('XML maxLength must resolve to an integer');
          if (typed.value < 0) break;   // -1, the default: no filter
          const filter = runtime.allocate('Landroid/text/InputFilter$LengthFilter;'); runtime.dispatch({ owner: 'Landroid/text/InputFilter$LengthFilter;', name: '<init>', signature: '(I)V', parameters: ['I'], result: 'V' }, [filter, typed.value], 'direct');
          const filters = runtime.newArray('[Landroid/text/InputFilter;', 1); runtime.object(filters).elements[0] = filter;
          runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'setFilters', signature: '([Landroid/text/InputFilter;)V', parameters: ['[Landroid/text/InputFilter;'], result: 'V' }, [value, filters], 'virtual'); break;
        }
        case 'touchscreenBlocksFocus': if (!runtime.isSubtype(type, 'Landroid/view/ViewGroup;')) break;   // ViewGroup(Context, AttributeSet): R.styleable.ViewGroup_touchscreenBlocksFocus -> setTouchscreenBlocksFocus
          if (typed.kind !== 'boolean') error('XML touchscreenBlocksFocus must resolve to a boolean'); runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'setTouchscreenBlocksFocus', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [value, typed.value ? 1 : 0], 'virtual'); break;
        case 'overScrollMode': runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setOverScrollMode', signature: '(I)V', parameters: ['I'], result: 'V' }, [value, typed.value], 'virtual'); break;
        default:
          this.leaveAttributeToClass(runtime, type, attribute, node, constructedAll);   // read by its own class, another class's, or reported
          break;
      } } catch (failure) {
        if (!this.isAttributeRefusal(failure)) throw failure;
        // an item of a style that is not an attribute of this View's classes is another class's (styles are shared: the tab strip's style carries the text attributes of its labels): nothing reads it
        if (!(attribute.fromStyle && !this.ownedByAncestryStyleable(runtime, type, attribute))) this.noteXmlAttributeNotApplied(runtime, attribute.name, node.name, this.refusalReason(failure), type, attribute.fromStyle ?? null);
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
      const styled = view.styledFont, inherited = !attrs.family && styled ? { typeface: styled.typeface, familyName: styled.familyName } : family;   // what the XML does not set keeps the value the style / its TextAppearance gave (TextView reads them all into one TextAppearanceAttributes)
      this.typefaceBuilder.applyTextViewFont(runtime, value, { ...inherited, typefaceIndex: attrs.typefaceIndex ?? styled?.typefaceIndex ?? -1, style: view.textStyle != null ? view.textStyle | 0 : styled?.style ?? 0, weight: attrs.weight ?? styled?.weight ?? -1 });
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
  /** A Bundle value read lazily from a Parcel whose class could not be loaded (src/binder-host.js): reading that key throws what reading it would have thrown (Android 13 LazyValue). */
  unreadableEntry(runtime, entry) { if (entry?.unreadable) runtime.throwJavaReference(entry.unreadable, runtime.object(entry.unreadable).message ?? null); }
  get(runtime, object, key, type, fallback) {
    const value = this.extras(runtime, object).get(checkString(key, 'Bundle/Intent key')); if (!value) return fallback;
    this.unreadableEntry(runtime, value);
    if (value.type === type || ['Ljava/lang/String;', 'Ljava/lang/CharSequence;'].includes(type) && ['Ljava/lang/String;', 'Ljava/lang/CharSequence;'].includes(value.type)) return value.value;
    // Bundle's reference getters read mMap.get(key) and cast it (android-13.0.0_r1 Bundle.getParcelableArrayList, getSerializable, getBundle...; a ClassCastException is a null):
    // a value stored through another put (an ArrayList put with putSerializable, read with getParcelableArrayList) is returned when it is an instance of the getter's type.
    const held = value.value;
    if ((type.startsWith('L') || type.startsWith('[')) && held && typeof held === 'object' && !nullish(held) && runtime.isSubtype(runtime.object(held).type, type)) return held;
    return fallback;
  }
  /** The launcher Intent a host request supplied (runtime.launch(activity, { intent })): it goes to the first Activity record created, with the NEW_TASK flag a system launch carries. */
  takeLaunchIntent(runtime, activity) {
    const intent = this.launchIntent; if (!intent || !sameRef(activity, runtime.activity)) return null;
    this.launchIntent = null; return this.copyIntent(runtime, runtime.object(intent), (runtime.object(intent).flags | 0) | LAUNCH_FLAG.NEW_TASK);
  }
  /** `am start` for an app that already runs: no source Activity, so the starter forces FLAG_ACTIVITY_NEW_TASK and launchMode / singleTop / onNewIntent decide the instance. */
  startFromSystem(runtime, intentValue) {
    const intent = runtime.object(intentValue); if (runtime.activity) this.syncCurrent(runtime);
    const target = this.activityTarget(runtime, intent);
    if (this.allFrames().length >= 32) error('Activity stack exceeds 32 frames');
    const copy = this.copyIntent(runtime, intent, intent.flags | 0); if (!intent.target) runtime.object(copy).target = target;
    this.starter.start(runtime, runtime.object(copy), target, null, { fromActivity: false });
  }
  initialIntent(runtime, frame) {
    if (!frame.intent) { frame.intent = runtime.makeObject(INTENT); const intent = runtime.object(frame.intent); intent.target = frame.type; intent.extras = new Map(); intent.extrasPresent = false; intent.extrasClassLoader = null; intent.flags = 0; }
    return frame.intent;
  }
  /** The fields PackageManager resolves an Intent by: action, data (Uri.toString), MIME type, categories, package. */
  intentFields(runtime, intent) {
    const data = intent.data ? runtime.dispatch({ owner: 'Landroid/net/Uri;', name: 'toString', signature: '()Ljava/lang/String;', parameters: [], result: 'Ljava/lang/String;' }, [intent.data], 'virtual') : null;
    return { action: intent.action ?? null, data: typeof data === 'string' ? data : data === null ? null : runtime.stringCharacters(data), type: intent.mimeType ?? null, categories: [...(intent.categories ?? [])], package: intent.package ?? null };
  }
  /** Intent.toString's short form, for ActivityNotFoundException and the run log. */
  describeIntentFields(fields, flags = 0) {
    const parts = [];
    if (fields.action) parts.push(`act=${fields.action}`);
    if (fields.categories.length) parts.push(`cat=[${fields.categories.join(',')}]`);
    if (fields.data) parts.push(`dat=${fields.data}`);
    if (fields.type) parts.push(`typ=${fields.type}`);
    if (fields.package) parts.push(`pkg=${fields.package}`);
    if (flags) parts.push(`flg=0x${(flags >>> 0).toString(16)}`);
    return `Intent { ${parts.join(' ')} }`;
  }
  /**
   * The Activity an Intent starts (ActivityTaskSupervisor.resolveActivity with MATCH_DEFAULT_ONLY): an explicit component must be an Activity packaged in this APK; an implicit Intent is
   * matched against the manifest's <intent-filter>s (src/intent-resolver.js; several matches: the first by priority, match quality and manifest order, where a device would show a chooser,
   * logged). Nothing to handle it: Instrumentation.checkStartActivityResult throws ActivityNotFoundException, which the app may catch. Only this app is installed on the lab's device, so an
   * Intent meant for another app (a browser, a store, the dialer) truthfully finds no Activity.
   */
  /** The component an Intent starts (ActivityRecord.mActivityComponent's class): the ComponentName it names, which may be an <activity-alias>, else the resolved class. */
  componentNameOf(runtime, intent, target) { const named = intent.component ? runtime.object(intent.component) : null, className = named ? (typeof named.className === 'string' ? named.className : nullish(named.className) ? null : runtime.stringCharacters(named.className)) : null; return className ? (className.startsWith('.') ? this.packageName + className : className) : dottedName(target); }
  activityTarget(runtime, intent, { systemPickers = false, caller = null } = {}) {
    // The package that starts it (src/package-registry.js): the package of the Context the call was made on, or the creator of the PendingIntent being sent.
    const P = this.packages, from = caller ?? (P.multi ? P.callerEntry(runtime) : P.main);
    // An explicit Activity of another installed package: resolved in that package's manifest and class loader, with Android's export and permission checks.
    const named = intent.component ? runtime.object(intent.component) : null, namedPackage = named ? (typeof named.packageName === 'string' ? named.packageName : nullish(named.packageName) ? null : runtime.stringCharacters(named.packageName)) : intent.componentPackage ?? null;
    if (namedPackage === SYSTEM_PACKAGE && this.packageName !== SYSTEM_PACKAGE) return this.systemActivityTarget(runtime, intent, named ? (typeof named.className === 'string' ? named.className : runtime.stringCharacters(named.className)) : dottedName(intent.target));
    if (P.multi && namedPackage && namedPackage !== this.packageName && P.byName(namedPackage)) {
      const className = named ? (typeof named.className === 'string' ? named.className : runtime.stringCharacters(named.className)) : dottedName(intent.target);
      return this.packageActivityTarget(runtime, intent, P.byName(namedPackage), className.startsWith('.') ? namedPackage + className : className, from);
    }
    if (intent.target) {
      const target = descriptor(intent.target);
      if (runtime.dex.classes.has(target) && runtime.isSubtype(target, ACTIVITY)) { if (P.multi && !from.main) this.checkActivityStart(runtime, intent, P.main, this.activityDeclaration(runtime, target) ?? { name: dottedName(target) }, from); return target; }   // the app's Activity started by a second package
      const component = intent.component ? runtime.object(intent.component) : null, packageName = component?.packageName ?? intent.componentPackage ?? this.packageName, className = component?.className ?? target.slice(1, -1).replaceAll('/', '.');
      runtime.record(`ACTIVITY start refused: {${packageName}/${className}} is not an Activity of this APK (ActivityNotFoundException)`);
      runtime.throwJava('Landroid/content/ActivityNotFoundException;', `Unable to find explicit activity class {${packageName}/${className}}; have you declared this activity in your AndroidManifest.xml?`);
    }
    const fields = this.intentFields(runtime, intent), described = this.describeIntentFields(fields, intent.flags | 0);
    const resolution = resolveIntentFields(this.manifest, fields, { defaultOnly: true });
    const packaged = resolution.matches.filter(entry => { const type = descriptor(entry.activity); return runtime.dex.classes.has(type) && runtime.isSubtype(type, ACTIVITY) && (!P.multi || from.main || this.activityStartAllowed(runtime, P.main, this.activityDeclaration(runtime, type) ?? {}, from)); });
    // The other installed packages' <intent-filter>s (PackageManagerService.queryIntentActivities over every package the caller can see; a filter of another uid only for an
    // exported Activity whose permission the caller holds). Ordered with the app's by priority, then the caller's own package first.
    const elsewhere = P.multi ? this.packageActivityMatches(runtime, fields, from) : [];
    if (elsewhere.length) {
      const all = [...packaged.map(match => ({ ...match, entry: P.main })), ...elsewhere].sort((a, b) => b.priority - a.priority || (b.entry === from) - (a.entry === from));
      const [chosen, ...rest] = all;
      runtime.record(`ACTIVITY ${described} -> ${chosen.entry.main ? '' : chosen.entry.name + '/'}${chosen.activity} [${chosen.filter}]${rest.length ? ` (also matched: ${rest.map(entry => (entry.entry.main ? '' : entry.entry.name + '/') + entry.activity).join(', ')}; a device would show a chooser)` : ''}`);
      return chosen.entry.main ? descriptor(chosen.activity) : P.typeIn(runtime, chosen.entry, chosen.activity);
    }
    if (!packaged.length) {
      if (systemPickers && this.sharedStorage.pickerFor(runtime, intent, fields)) return null;   // a system picker of the device answers it (src/shared-storage-host.js)
      runtime.record(`ACTIVITY ${described} unresolved: no Activity found to handle it (${resolution.considered.length} filter(s) considered; ${P.multi ? 'no installed package has an Activity for it' : 'only this app is installed'})`);
      runtime.throwJava('Landroid/content/ActivityNotFoundException;', `No Activity found to handle ${described}`);
    }
    const [chosen, ...others] = packaged;
    runtime.record(`ACTIVITY ${described} -> ${chosen.activity} [${chosen.filter}]${others.length ? ` (also matched: ${others.map(entry => entry.activity).join(', ')}; a device would show a chooser)` : ''}`);
    return descriptor(chosen.activity);
  }
  /**
   * An explicit Activity of an installed package other than the app (ActivityTaskSupervisor.resolveActivity, then checkStartAnyActivityPermission): declared in that package's
   * manifest, enabled and visible to the caller (package visibility applies to explicit Activity starts from API 30), else ActivityNotFoundException as Instrumentation
   * reports it; then the export and permission checks; the class is that package's own (its loader alias).
   */
  packageActivityTarget(runtime, intent, entry, className, from) {
    const P = this.packages, declaration = (entry.manifest?.activities ?? []).find(activity => activity.name === className) ?? null, component = `{${entry.name}/${className}}`;
    const disabled = declaration && (declaration.enabled === false || declaration.enabled === 0 || declaration.enabled === 'false');
    if (!declaration || disabled || !P.visible(runtime, from, entry)) {
      runtime.record(`ACTIVITY start refused: ${component} ${!declaration ? `is not an Activity of the installed package ${entry.name}` : disabled ? 'is disabled' : `is in ${entry.name}, which ${from.name} cannot see (package visibility)`} (ActivityNotFoundException)`);
      runtime.throwJava('Landroid/content/ActivityNotFoundException;', `Unable to find explicit activity class ${component}; have you declared this activity in your AndroidManifest.xml?`);
    }
    this.checkActivityStart(runtime, intent, entry, declaration, from);
    const type = P.typeIn(runtime, entry, className);
    if (!type || !runtime.isSubtype(type, ACTIVITY)) throw new APKError(`Unable to instantiate activity ComponentInfo${component}: ${className} is not an Activity class of ${entry.name}`, { kind: 'package-activity-class', package: entry.name, activity: className });
    return type;
  }
  /** ActivityTaskSupervisor.checkStartAnyActivityPermission: a package starts its own Activities; another uid only an exported Activity whose android:permission it holds. */
  activityStartAllowed(runtime, entry, declaration, from) {
    if (from.uid === entry.uid) return true;
    const P = this.packages, exported = P.exported(entry, { ...declaration, kind: 'activity', actions: (declaration.filters ?? []).flatMap(filter => filter.actions ?? []) });
    return exported && (!declaration.permission || P.holds(runtime, from, declaration.permission));
  }
  checkActivityStart(runtime, intent, entry, declaration, from) {
    if (this.activityStartAllowed(runtime, entry, declaration, from)) return;
    const P = this.packages, exported = P.exported(entry, { ...declaration, kind: 'activity', actions: (declaration.filters ?? []).flatMap(filter => filter.actions ?? []) });
    const name = entry.main ? this.packageName : entry.name, short = declaration.name.startsWith(name + '.') ? declaration.name.slice(name.length) : declaration.name, fields = this.intentFields(runtime, intent), parts = [];
    if (fields.action) parts.push(`act=${fields.action}`); if (fields.categories.length) parts.push(`cat=[${fields.categories.join(',')}]`); if (fields.data) parts.push(`dat=${fields.data}`);
    parts.push(`cmp=${name}/${short}`); if (intent.extrasPresent || intent.extras?.size) parts.push('(has extras)');
    const caller = `ProcessRecord{${from.pid}:${from.main ? this.packageName : from.name}/u0a${from.uid - 10000}} (pid=${from.pid}, uid=${from.uid})`;
    const message = `Permission Denial: starting Intent { ${parts.join(' ')} } from ${caller} ${exported ? `requires ${declaration.permission}` : `not exported from uid ${entry.uid}`}`;
    runtime.record(`LOG W ActivityTaskManager: ${message}`);
    runtime.throwJava('Ljava/lang/SecurityException;', message);
  }
  /** The Activities of the other installed packages an implicit Intent resolves to, for package `from`: visible packages, matching filters, startable by `from` (exported, permission held). */
  packageActivityMatches(runtime, fields, from) {
    const P = this.packages, out = [];
    for (const entry of P.companions()) {
      if (entry === from ? false : !P.visible(runtime, from, entry)) continue;
      const { matches } = resolveIntentFields(entry.manifest, fields, { defaultOnly: true });
      for (const match of matches) {
        const declaration = (entry.manifest.activities ?? []).find(activity => activity.name === match.activity); if (!declaration || !this.activityStartAllowed(runtime, entry, declaration, from)) continue;
        const type = P.typeIn(runtime, entry, match.activity); if (!type || !runtime.isSubtype(type, ACTIVITY)) continue;
        out.push({ ...match, entry });
      }
    }
    return out;
  }
  startActivity(runtime, intentValue, resultCaller = null, requestCode = -1, context = {}) {
    if (this.camera.interceptStartActivity(runtime, intentValue, resultCaller, requestCode)) return;   // a camera capture Intent: the page's camera screen answers it (src/camera-capture-intent.js)
    const intent = runtime.object(intentValue); this.syncCurrent(runtime);
    // ActivityTaskManager: a start whose caller Activity is gone (finished or destroyed, or no Activity is resumed) has no source record and runs as a new task (FLAG_ACTIVITY_NEW_TASK is forced, not an error).
    const liveSource = !nullish(runtime.activity) && !this.finishedActivities.has(runtime.activity.ref), sourceFrame = liveSource ? this.frame(runtime) : null;
    // The calling package: the creator of a PendingIntent being sent (context.callerEntry), else the package of the Context the call was made on (src/package-registry.js).
    const P = this.packages, from = context.callerEntry ?? (P.multi ? (context.caller && typeof context.caller === 'object' ? P.contextEntry(runtime, context.caller) : resultCaller && typeof resultCaller === 'object' ? P.contextEntry(runtime, resultCaller) : P.callerEntry(runtime)) : P.main);
    const target = this.activityTarget(runtime, intent, { systemPickers: true, caller: from });
    if (target === null) return this.sharedStorage.startPicker(runtime, intent, this.sharedStorage.pickerFor(runtime, intent), resultCaller, requestCode, sourceFrame);   // GET_CONTENT / OPEN_DOCUMENT / PICK / PICK_IMAGES: the page's system picker, the answer comes through onActivityResult
    if (this.allFrames().length >= 32) error('Activity stack exceeds 32 frames');
    const fromActivity = context.fromActivity !== false && !this.systemLaunch && sourceFrame !== null;
    // ContextImpl.startActivity: outside an Activity context the NEW_TASK flag is mandatory (apps targeting below N or P and above).
    if (context.fromActivity === false && !this.systemLaunch && !((intent.flags | 0) & LAUNCH_FLAG.NEW_TASK)) {
      const targetSdk = from.main ? Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1) : P.targetSdk(from);
      if (targetSdk < 24 || targetSdk >= 28) this.throwAndroidRuntime(runtime, 'Calling startActivity() from outside of an Activity  context requires the FLAG_ACTIVITY_NEW_TASK flag. Is this really what you want?');
    }
    if (fromActivity && requestCode >= 0 && ((intent.flags | 0) & LAUNCH_FLAG.FORWARD_RESULT)) this.throwAndroidRuntime(runtime, 'FORWARD_RESULT_FLAG used while also requesting a result');
    // "Activities ignoradas" (src/ignored-activities.js): a debugging tool; the start was validated like any other and is now dropped, counted and logged (null list: one property test).
    if (this.ignoredActivities !== null && this.ignoredActivities !== undefined && ignoreActivityStart(runtime, target, this.systemLaunch ? 'PendingIntent.send' : requestCode >= 0 ? 'startActivityForResult' : 'startActivity')) return;
    // ActivityTaskManager.startActivity is asynchronous for the caller: the Intent is validated and copied (it is parceled) now, the stack change and the lifecycle run as a later
    // main-thread event, after the callback that made the call has returned. Several calls queue in order.
    // An Activity of another package receives the Intent as it leaves the caller's process: parcelled and read with the target package's class loader (its own Parcelable classes).
    const targetPackage = this.activityPackage(runtime, target), crossing = P.multi && targetPackage !== from;
    const copy = crossing ? this.intentCrossCopy(runtime, intentValue, P.loaderOf(runtime, targetPackage)) : this.copyIntent(runtime, intent, intent.flags | 0), batch = this.currentBatch ?? null;
    if (crossing) { const delivered = runtime.object(copy); delivered.flags = intent.flags | 0; runtime.record(`ACTIVITY start {${targetPackage.main ? this.packageName : targetPackage.name}/${dottedName(target)}} from package ${from.main ? this.packageName : from.name} (uid ${from.uid})`); }
    runtime.object(copy).launchedFrom = { uid: from.uid, packageName: from.main ? this.packageName : from.name };   // ActivityRecord.launchedFromUid / launchedFromPackage
    if (!intent.target || crossing) { runtime.object(copy).target = target; if (!targetPackage.main) { runtime.object(copy).componentPackage = targetPackage.name; runtime.object(copy).component = null; } }   // the system fills the resolved component into the Intent the Activity receives (the caller's Intent is unchanged)
    // FLAG_ACTIVITY_FORWARD_RESULT is resolved by the system at the call: the caller's result target moves to the new Activity (and the caller, which usually finishes next, no longer owes a result).
    let forward = null;
    if (fromActivity && ((intent.flags | 0) & LAUNCH_FLAG.FORWARD_RESULT)) { forward = { receiver: sourceFrame.resultReceiver ?? null, code: sourceFrame.resultRequestCode ?? -1 }; sourceFrame.resultReceiver = null; sourceFrame.resultRequestCode = -1; }
    // The queued start is counted on the caller's frame (its finish() waits for the start, and a content-less caller is not an error while it is pending); a start with no live
    // source record (the Application context, or an Activity that already finished) has no frame to wait on and is counted on the platform instead.
    if (sourceFrame) sourceFrame.pendingStarts = (sourceFrame.pendingStarts ?? 0) + 1; else this.sourcelessStarts = (this.sourcelessStarts ?? 0) + 1;
    const roots = sourceFrame ? [copy, resultCaller, sourceFrame.activity] : [copy, resultCaller];
    const run = () => {
      // A background render is in progress (src/render-variant.js; null otherwise: one property test): a start made by the background instance is dropped and reported, one made by
      // an Activity of the visible stack waits for the render to end.
      const held = this.backgroundRender ? this.backgroundRender.holdStart(runtime, target, context.caller ?? resultCaller) : null;
      if (held === 'defer') { this.queueTask(run, 100, roots); return; }
      if (sourceFrame) sourceFrame.pendingStarts--; else this.sourcelessStarts--;
      if (held === 'drop') return;
      this.runStart(runtime, runtime.object(copy), target, sourceFrame, { resultCaller, requestCode, fromActivity, forward }, batch);
    };
    this.queueTask(run, 0, roots);
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
    if (this.companionUi && frame.pendingActivityResults?.length) return this.inFramePackage(runtime, frame, () => this.deliverActivityResultsNow(runtime, frame));
    return this.deliverActivityResultsNow(runtime, frame);
  }
  deliverActivityResultsNow(runtime, frame) {
    while (frame.pendingActivityResults?.length) {
      const result = frame.pendingActivityResults.shift(); runtime.record(`ACTIVITY result ${result.requestCode} code ${result.resultCode}`);
      const fragment = frame.fragmentRequests?.get(result.requestCode);   // Activity.dispatchActivityResult: a request made by startActivityFromFragment goes to that Fragment instead of the Activity
      if (fragment) { frame.fragmentRequests.delete(result.requestCode); runtime.dispatch({ owner: FRAGMENT, name: 'onActivityResult', signature: '(IILandroid/content/Intent;)V', parameters: ['I', 'I', INTENT], result: 'V' }, [fragment, result.requestCode, result.resultCode, result.data], 'virtual'); continue; }
      runtime.dispatch({ owner: ACTIVITY, name: 'onActivityResult', signature: '(IILandroid/content/Intent;)V', parameters: ['I', 'I', INTENT], result: 'V' }, [frame.activity, result.requestCode, result.resultCode, result.data], 'virtual');
    }
  }
  /** The teardown of one Activity: result captured, onPause / onStop / onDestroy as its state needs, removed from its task, the result handed to the Activity that asked for it. */
  retireFrame(runtime, frame, { deferStop = false } = {}) {
    const activity = frame.activity;
    frame.finishing = true;
    const state = runtime.object(activity); let data = state.activityResultData ?? null;
    const receiverPackage = data && frame.resultReceiver && this.packages.multi ? this.activityPackage(runtime, runtime.object(frame.resultReceiver).type) : null;
    if (data && receiverPackage && receiverPackage !== (frame.packageEntry ?? this.packages.main)) data = this.intentCrossCopy(runtime, data, this.packages.loaderOf(runtime, receiverPackage));   // the result leaves the process (ActivityResult parcels it): read with the caller's class loader
    else if (data) { const copy = runtime.allocate(INTENT); runtime.dispatch({ owner: INTENT, name: '<init>', signature: '(Landroid/content/Intent;)V', parameters: [INTENT], result: 'V' }, [copy, data], 'direct'); data = copy; }
    const result = { requestCode: frame.resultRequestCode, resultCode: state.activityResultCode ?? 0, data };
    if (frame.lifecycleStage === 4) this.lifecycleCall(runtime, frame.activity, 'onPause');
    if (deferStop && frame.lifecycleStage >= 2) {
      // finish() from app code: ActivityRecord.finishIfPossible pauses it now, and the stop and destroy come once the Activity brought to the front reports idle
      // (ActivityTaskSupervisor.activityIdleInternal, or IDLE_TIMEOUT 10 s): until then it is finishing but not destroyed, and work it posted still finds its FragmentManager alive.
      this.removeFrame(frame); (this.stoppingFrames ??= []).push(frame);
      this.queueTask(() => this.stopFinished(runtime, frame), STOP_IDLE_TIMEOUT_MS, [frame.activity]);
    } else { this.destroyFinished(runtime, frame); this.removeFrame(frame); }
    const receiver = frame.resultReceiver && this.allFrames().find(candidate => sameRef(candidate.activity, frame.resultReceiver)); if (receiver) (receiver.pendingActivityResults ||= []).push(result);
    runtime.record(`ACTIVITY finish ${frame.type}`);
  }
  /** onStop and onDestroy of an Activity that finished (retireFrame): it is then detached for good. */
  destroyFinished(runtime, frame) {
    if (frame.lifecycleStage >= 3) this.lifecycleCall(runtime, frame.activity, 'onStop'); this.lifecycleCall(runtime, frame.activity, 'onDestroy');
    frame.finished = true; this.finishedActivities.add(frame.activity.ref);
  }
  /** The deferred stop of a finished Activity (at the main thread's next idle moment, or the timeout): once. */
  stopFinished(runtime, frame) {
    const list = this.stoppingFrames ?? []; if (!list.includes(frame) || frame.stopping) return;
    frame.stopping = true;   // still found (activityFrame) while its onStop/onDestroy run: Pre/Post callbacks, isDestroyed() true inside onDestroy, its window removed
    const traced = runtime.hostTaskTrace; runtime.hostTaskTrace = true;   // a host task of the Looper: what the teardown records is not the pump's own plumbing
    try { this.destroyFinished(runtime, frame); } finally { runtime.hostTaskTrace = traced; const at = list.indexOf(frame); if (at >= 0) list.splice(at, 1); }
  }
  /** Finishes several Activities at once (finishAffinity, finishAndRemoveTask, navigateUpTo): the ones that are not on top go first so that nothing in between is resumed; the top one last brings the survivor to the front. */
  /**
   * Activity.finish and friends called on another thread than the main one (a network callback's thread, a Binder thread): on Android they are a request to ActivityTaskManager and the
   * lifecycle (onPause, onStop, onDestroy) reaches the Activity later, on its main thread; isFinishing() is true at once. The VM's lifecycle runs on the thread that asks for it, so a
   * request from another thread is marked and carried out by the main Looper.
   */
  offMainThread(runtime) { return !!runtime.thread && !!runtime.scheduler && runtime.thread !== runtime.scheduler.mainThread(); }
  finishFrames(runtime, frames) {
    if (this.offMainThread(runtime)) { for (const frame of frames) frame.finishQueued = true; this.queueTask(() => { for (const frame of frames) frame.finishQueued = false; this.finishFrames(runtime, frames); }, 0, frames.map(frame => frame.activity)); return; }
    const current = this.tasks.at(-1)?.frames.at(-1), list = frames.filter(frame => this.allFrames().includes(frame));
    if (list.includes(current) && !current.lifecycleDepth) this.pauseForLaunch(runtime, current, false);   // the resumed Activity pauses first, as in ActivityRecord.finishIfPossible
    for (const frame of list) if (frame !== current && this.allFrames().includes(frame)) this.finish(runtime, frame.activity);
    if (list.includes(current) && this.allFrames().includes(current)) this.finish(runtime, current.activity);
  }
  finish(runtime, activity) {
    if (this.offMainThread(runtime)) { const pending = this.allFrames().find(frame => sameRef(frame.activity, activity)); if (pending && !pending.finishing) { pending.finishQueued = true; this.queueTask(() => { pending.finishQueued = false; if (this.allFrames().includes(pending)) this.finish(runtime, activity); }, 0, [activity]); return; } }
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
    this.retireFrame(runtime, frame, { deferStop: true });
    this.lastTransition = { kind: 'close', animated: true, from: frame.type, to: null, enterAnim: overrides ? overrides.enter : 0, exitAnim: overrides ? overrides.exit : 0, overridden: !!overrides };
    if (!wasCurrent) return; // A previous Splash may finish after starting a child.
    const previous = this.frames.at(-1);
    if (previous) this.resumeFrame(runtime, previous);
    else { runtime.activity = null; runtime.activityType = null; runtime.root = null; this.taskClosed = true; }
  }

  viewRoots(runtime) { return this.dialogWindowHost.roots(runtime); }
  back(runtime) { if(this.dialogWindowHost.back(runtime))return; if (!runtime.activity) error('No active Activity to navigate back from'); if (this.backDispatcher.dispatchBack(runtime, runtime.activity)) return; return runtime.dispatch({ owner: ACTIVITY, name: 'onBackPressed', signature: '()V', parameters: [], result: 'V' }, [runtime.activity], 'virtual'); }
  /**
   * The hosts of invoke()'s dispatch chain that claim `key`, in the chain's order (CHAIN_HOSTS), memoised per key like chainTouches: every host's `supports` is a fixed key set, so
   * the answer depends on the key alone. Before, every bridged call into the chain rebuilt the key text once per host it asked (up to 26 strings, flattened and hashed for each lookup).
   */
  chainRoute(key) {
    if (this.chainRouteFor !== this.contractHosts.length) { this.chainRoutes = new Map(); this.chainRouteFor = this.contractHosts.length; }
    let route = this.chainRoutes.get(key);
    if (route === undefined) { route = CHAIN_HOSTS.filter(entry => entry.claims(this, key)); this.chainRoutes.set(key, route = route.length ? route : NO_ROUTE); }
    return route;
  }
  invoke(runtime, method, args, mode, knownKey) {
    const owner = method.owner, name = method.name, receiver = args[0];
    if (this.packages.multi) {   // the Resources (and, once a second package has a window, the Theme, Context, Activity and Views) of a package read its own table
      const entry = this.packageScopeOf(runtime, method, args, mode); if (entry && entry !== this.resourcePackageEntry) return this.withPackageResources(runtime, entry, () => this.invoke(runtime, method, args, mode, knownKey));
    }
    const key = knownKey ?? `${owner}->${name}${method.signature}`;   // knownKey: the bridge's key (APKRuntime.bridgeCore), the same text
    {   // the contract host that serves the key is remembered once found (about thirty hosts were asked on every bridged call); a miss is remembered while no host defines a method (hostDefinitions)
      // and the host list is the same, since hosts can define methods later
      const routes = this.contractRoutes ??= new Map(); let host = routes.get(key);
      if (host === undefined || !host.supports(key)) {
        if (this.contractMissesAt !== hostDefinitions() || this.contractMissesFor !== this.contractHosts.length) { this.contractMisses = new Set(); this.contractMissesAt = hostDefinitions(); this.contractMissesFor = this.contractHosts.length; }
        host = this.contractMisses.has(key) ? undefined : this.contractHosts.find(candidate => candidate.supports(key));
        if (host !== undefined) routes.set(key, host); else { routes.delete(key); this.contractMisses.add(key); }
      }
      if (host !== undefined) return host.invoke(runtime, method, args);
    }
    const route = this.chainRoute(key);
    for (let i = 0; i < route.length; i++) { const result = route[i].call(this, runtime, method, args); if (result !== CHAIN_NEXT) return result; }
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
      if (name === '<init>') return;   // the abstract class's constructor: a Java subclass (a delegating wrapper of the app's PackageManager) is constructed through it
      if (name === 'hasSystemFeature') { if (args[1] === null || args[1] === 0) runtime.throwJava('Ljava/lang/NullPointerException;', null); return this.systemFeatures.has(runtime.stringCharacters(args[1])) && (args.length < 3 || args[2] <= 0) ? 1 : 0; }   // only DEVICE_FEATURES (src/service-kit.js), at version 0
      if (name === 'getApplicationInfo') { if (args[1] !== this.packageName) error(`PackageManager has no external package ${args[1]}`); return this.applicationInfo(runtime, (Number(args[2]) & 128) !== 0); }
      const component = runtime.object(args[1]);
      if (name === 'getActivityInfo' && this.packages.multi) {   // an Activity of a second installed package the caller can see: its own manifest declaration and ApplicationInfo
        const jsText = value => typeof value === 'string' ? value : nullish(value) ? null : runtime.stringCharacters(value), other = this.packages.byName(jsText(component.packageName));
        if (other && !other.main) {
          const className = jsText(component.className), declaration = (other.manifest?.activities ?? []).find(activity => activity.name === className);
          if (!declaration || !this.packages.visible(runtime, this.packages.callerEntry(runtime), other)) runtime.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${other.name}/${className}}`);
          return this.activityInfoObject(runtime, other, declaration, Number(args[2]) | 0);
        }
      }
      if (component.packageName !== this.packageName) error('PackageManager can only query this APK');
      if(name==='getServiceInfo'){if(!this.manifest?.services?.includes(component.className))runtime.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;',component.className);error('ServiceInfo metadata transport is not installed for declared service '+component.className,{kind:'service-info-unsupported'});}
      const declaration = this.manifest?.activities?.find(activity => activity.name === component.className);
      if (!declaration) error(`Activity missing from actual manifest: ${component.className}`);
      return this.activityInfoObject(runtime, this.packages.main, declaration, Number(args[2]) | 0);
    }
    if (owner === COMPONENT) {
      const object = runtime.object(receiver);
      // ComponentName(Context, ...): the package is the Context's (a companion package's Context names its own); a class of a companion is named without its loader alias
      if (name === '<init>') { object.packageName = typeof args[1] === 'string' ? args[1] : this.contextPackageName(runtime, args[1]); object.className = method.parameters[1] === 'Ljava/lang/Class;' ? dottedName(runtime.object(args[2]).classType) : args[2]; return; }
      if (name === 'getClassName') return object.className; if (name === 'getPackageName') return object.packageName;
      return `${object.packageName}/${name === 'flattenToShortString' && object.className.startsWith(object.packageName + '.') ? object.className.slice(object.packageName.length) : object.className}`;
    }
    if (owner === CONFIGURATION) {
      const fields = runtime.object(receiver).fields;
      // Configuration.equals: the same values in every field (compareTo() == 0); the locale lists compare by their locales.
      if (name === 'equals') {
        if (nullish(args[1])) return 0; if (sameRef(args[1], receiver)) return 1;
        const other = runtime.object(args[1]); if (other.type !== runtime.object(receiver).type) return 0;
        const tags = ref => { const o = nullish(ref) ? null : runtime.object(ref); return o?.locales ? o.locales.map(locale => runtime.object(locale).localeData?.tag).join(',') : o?.localeData ? o.localeData.tag : undefined; };
        for (const key of new Set([...fields.keys(), ...other.fields.keys()])) {
          const mine = fields.get(key) ?? 0, theirs = other.fields.get(key) ?? 0; if (mine === theirs || nullish(mine) && nullish(theirs)) continue;
          if (typeof mine === 'object' && typeof theirs === 'object' && mine && theirs && (sameRef(mine, theirs) || tags(mine) !== undefined && tags(mine) === tags(theirs))) continue;
          return 0;
        }
        return 1;
      }
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
      const view = this.inflate(runtime, this.xmlHost.markLayout(this.resources?.getLayout(args[1])) ?? error('XML resources unavailable'), object.context);
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
      if (name === '<init>') { if (method.parameters[0] === 'Landroid/content/Context;') { this.layoutParamsFromAttributes(runtime, null, args[2], receiver, args[1], owner); return; } if (method.parameters[0] === 'I') { runtime.storeField(fields, `${LAYOUT_PARAMS}->width:I`, args[1]); runtime.storeField(fields, `${LAYOUT_PARAMS}->height:I`, args[2]); if (method.parameters.length === 3) runtime.storeField(fields, 'Landroid/widget/LinearLayout$LayoutParams;->weight:F', args[3]); } else { for (const [key, value] of runtime.object(args[1]).fields) runtime.storeField(fields, key, value); const state = runtime.object(args[1]).marginState; if (state) object.marginState = { ...state }; /* MarginLayoutParams(MarginLayoutParams): the relative margins and their flags are copied too */ } return; }
      for (const [index, edge] of ['left', 'top', 'right', 'bottom'].entries()) runtime.storeField(fields, `${MARGIN_PARAMS}->${edge}Margin:I`, args[index + 1]);
      if (object.marginState) { object.marginState.leftUndefined = false; object.marginState.rightUndefined = false; }   // MarginLayoutParams.setMargins
      return;
    }
    if (owner === EDITABLE) { const text = runtime.object(runtime.object(receiver).sourceView).text; if (name === 'toString') return text; if (name === 'length') return text.length; if (name === 'charAt') { if (args[1] < 0 || args[1] >= text.length) error('Editable charAt index out of bounds'); return text.charCodeAt(args[1]); } return text.slice(args[1], args[2]); }
    if ([FRAGMENT, FRAGMENT_MANAGER, TRANSACTION].includes(owner)) return this.fragmentInvoke(runtime, method, args);
    if (owner === KEY_SET || owner === KEY_ITERATOR) return this.keyViewInvoke(runtime, method, args);
    if (owner === INTENT) return this.intentInvoke(runtime, method, args);
    if (owner === BUNDLE || owner === 'Landroid/os/BaseBundle;' || owner === 'Landroid/os/PersistableBundle;') return this.bundleInvoke(runtime, method, args);
    if (CONTEXTS.includes(owner)) {
      if (this.packages.multi) { const handled = this.packages.contextInvoke(runtime, method, args); if (handled !== this.packages.NOT_HANDLED) return handled; }   // a companion package's Context (src/package-registry.js)
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
      if ((name === 'getPackageName' || name === 'getOpPackageName' || name === 'getBasePackageName') && receiver && typeof receiver === 'object') { for (let c = receiver, depth = 0; c && typeof c === 'object' && depth < 8; depth++) { const o = runtime.object(c); if (o.systemPackageName) return o.systemPackageName; c = o.baseContext ?? null; } }
      if (name === 'getPackageName') { const packageName = this.packageName || this.resources?.table?.packages?.[0]?.name; if (!packageName) error('Manifest package name unavailable'); return packageName; }
      if (name === 'attachBaseContext' || name === '<init>' && owner === 'Landroid/content/ContextWrapper;') { runtime.object(receiver).baseContext = args[1]; return; }
      if (name === 'getWindowManager' && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY)) return runtime.dispatch({ owner: 'Landroid/content/Context;', name: 'getSystemService', parameters: ['Ljava/lang/String;'], result: 'Ljava/lang/Object;', signature: '(Ljava/lang/String;)Ljava/lang/Object;' }, [receiver, 'window'], 'virtual');   // Activity.getWindowManager: the window's WindowManager (the 'window' service)
      if (name === 'getOnBackInvokedDispatcher' && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY)) return this.backDispatcher.forOwner(runtime, receiver);
      if (name === 'getBaseContext') return runtime.object(receiver).baseContext ?? null;
      if (name === '<init>') { this.frame(runtime, receiver); const base='Landroid/view/ContextThemeWrapper;';if(owner===ACTIVITY&&runtime.dex.bootClasses?.has(base))runtime.dispatch({owner:base,name:'<init>',parameters:[],result:'V',signature:'()V'},[receiver],'direct'); return; }
      if (name === 'onCreate') { const frame = this.frame(runtime, receiver); frame.lifecycleStage = 1; this.strictModeActivity(runtime, receiver, 'created'); this.moveFragments(runtime, frame, 1); this.notifyActivity(runtime, frame, 'Created', args[1]); return; }
      if (name === 'getResources') return this.resourcesForContext(runtime,receiver);
      if (name === 'getString' || name === 'getText') return this.stringResource(runtime, args[1]);
      if (name === 'startActivity') return this.startActivity(runtime, args[1], null, -1, { fromActivity: this.isActivityContext(runtime, receiver), caller: receiver });
      if (name === 'startActivityForResult') { if (args[3] && this.extras(runtime, args[3]).size) error('Non-empty Activity launch options require their original transition/window boundary'); return this.startActivity(runtime, args[1], receiver, args[2]); }
      if (name === 'setResult') { if (args[2] && !runtime.isSubtype(runtime.object(args[2]).type, INTENT)) error('Activity result data must be an Intent'); const object = runtime.object(receiver); object.activityResultCode = args[1]; object.activityResultData = args[2] || null; return; }
      if (name === 'onActivityResult') return; // Empty Activity base callback; APK/AndroidX overrides have DEX priority.
      if (name === 'isFinishing') { const target = this.activityFrame(receiver); return this.finishedActivities.has(receiver.ref) || target?.finishRequested || target?.finishing || target?.finishQueued ? 1 : 0; }
      if (name === 'isDestroyed') return this.finishedActivities.has(receiver.ref) || this.activityFrame(receiver)?.destroyed ? 1 : 0;
      const frame = this.frame(runtime, receiver);
      if (name === 'getComponentName') { const component = runtime.makeObject(COMPONENT); Object.assign(runtime.object(component), { packageName: frame.packageEntry?.name ?? this.packageName, className: dottedName(frame.type) }); return component; }
      if (name === 'getLocalClassName') { const className = dottedName(frame.type), prefix = (frame.packageEntry?.name ?? this.packageName) + '.'; return className.startsWith(prefix) ? className.slice(prefix.length) : className; }
      if (name === 'getLayoutInflater') return this.inflater(runtime, receiver);
      if (name === 'onCreateView') { if (method.parameters.length === 3) return null; if (args[2] === 'fragment') error('Native framework <fragment> inflation requires its Fragment inflater boundary'); return runtime.dispatch({ owner: ACTIVITY, name: 'onCreateView', signature: '(Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', parameters: ['Ljava/lang/String;', 'Landroid/content/Context;', 'Landroid/util/AttributeSet;'], result: 'Landroid/view/View;' }, [receiver, args[2], args[3], args[4]], 'virtual'); }
      if (name === 'getTitle') { const object = runtime.object(receiver); if (object.title !== undefined) return object.title; const declaration = this.activityDeclaration(runtime, frame.type), own = frame.packageEntry; const label = declaration?.label ?? (own ? own.manifest : this.manifest)?.application?.label ?? declaration?.name ?? own?.name ?? this.packageName; return object.title = typeof label === 'number' ? this.stringResource(runtime, label) : label; }
      if (name === 'setTitle') { runtime.object(receiver).title = method.parameters[0] === 'I' ? this.stringResource(runtime, args[1]) : args[1]; if (runtime.objectOverride?.(runtime.object(receiver).type, 'onTitleChanged(Ljava/lang/CharSequence;I)V')) runtime.dispatch({ owner: ACTIVITY, name: 'onTitleChanged', signature: '(Ljava/lang/CharSequence;I)V', parameters: ['Ljava/lang/CharSequence;', 'I'], result: 'V' }, [receiver, runtime.object(receiver).title, runtime.object(receiver).titleColor ?? 0], 'virtual'); return; }
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
      if (name === 'getIntent') return frame.intentNull ? null : this.initialIntent(runtime, frame);
      // Activity.setIntent: mIntent = newIntent, whatever Intent it is (an app's subclass of Intent too), or null (getIntent then answers null)
      if (name === 'setIntent') { const value = args[1]; if (value === null || value === undefined || value === 0) { frame.intent = null; frame.intentNull = true; return; } if (!runtime.isSubtype(runtime.object(value).type, INTENT)) error('setIntent requires Intent'); frame.intent = value; frame.intentNull = false; return; }
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
    if (name === '<init>' && method.parameters[0] === 'Landroid/content/Context;') { object.context = args[1]; this.tagPackageView(runtime, object, args[1]); object.enabled = true; if (object.type === 'Landroid/view/ViewOverlay$OverlayViewGroup;') this.viewApi.initOverlayGroup(runtime, receiver); if(method.parameters[2]==='I'){object.defStyleAttr=args[3];object.defStyleExplicit=true;if(method.parameters[3]==='I')object.defStyleRes=args[4];} if (runtime.isSubtype(object.type, 'Landroid/widget/TextView;')) object.textSize = Math.fround((runtime.isSubtype(object.type, 'Landroid/widget/EditText;') ? 18 : 14) * (this.device.fontScale || 1)); /* these defaults are sp values (scaledDensity = density * fontScale) */ this.viewXmlAttributes?.construct(runtime, receiver, args[2] ? runtime.object(args[2]).node ?? null : null, args[1]); /* View(Context, AttributeSet, int, int) and ViewGroup.initFromAttributes: R.styleable.View / ViewGroup from the tag, its style, the default style and the theme (view-xml-attributes.js) */ this.drawableViewHost.applyThemeDefaults(runtime, receiver, args[2]); if (!object.textViewAttributesApplied) { this.drawableViewHost.applyStyledTextSize(runtime, receiver, args[2]); this.drawableViewHost.applyStyledTextAppearance(runtime, receiver, args[2]); } /* else the TextView constructor pass (textview-xml-attributes.js) read the text size and the text appearance with every other attribute */ if (args[2] && runtime.object(args[2]).node) this.inflate(runtime, runtime.object(args[2]).node, args[1], 0, { existing: receiver, applyOnly: true }); else this.applyDefaultStyleInCode(runtime, receiver); /* a View built in code: what its default style gives the classes without a constructor pass */ this.syncViewFields(runtime, receiver); return; }
    if (owner === 'Landroid/content/res/Resources;') {
      if (name === 'getConfiguration') return this.resourceConfiguration(runtime,receiver);
      if (name === 'updateConfiguration' && this.overrideResources(runtime, receiver)) return this.updateOverrideConfiguration(runtime, receiver, args[1], args[2]);
      if (receiver && typeof receiver === 'object') { const target = this.overrideResources(runtime, receiver); if (target !== (this.activeResources ?? null)) return this.withResources(runtime, target, () => this.invoke(runtime, method, args)); }   // every lookup below selects variants for this Resources' own configuration
      if (name === 'getDisplayMetrics') return this.metrics(runtime);
      if (name === 'updateConfiguration') {
        // Resources.updateConfiguration(config, metrics): the framework swaps the resources' configuration and re-selects every qualified resource. Resource selection here follows the virtual
        // device (Dispositivo panel); a configuration that differs from it (a new locale, font scale, night mode...) would need a second selection pass, so it fails explicitly. The common
        // "re-apply the current configuration" call is accepted and re-resolves live Themes.
        const incoming = args[1], metricsArg = args[2];
        if (incoming !== null && incoming !== 0 && incoming !== undefined) {
          const current = this.resourceConfiguration(runtime, null), changes = runtime.dispatch({ owner: CONFIGURATION, name: 'diff', parameters: [CONFIGURATION], result: 'I', signature: `(${CONFIGURATION})I` }, [current, incoming], 'virtual');
          if (changes !== 0) {
            // ResourcesImpl.updateConfiguration on the shared Resources: from here on this Resources object selects against its own merged Configuration (the same path as a
            // createConfigurationContext Resources). It is the one Resources object every plain Context of this process shares, so the change is process-wide, as it is on Android
            // for an Application's Resources (AppCompat's night-mode / locale fallback relies on exactly this).
            const merged = runtime.allocate(CONFIGURATION);
            runtime.dispatch({ owner: CONFIGURATION, name: '<init>', parameters: [CONFIGURATION], result: 'V', signature: `(${CONFIGURATION})V` }, [merged, current], 'direct');
            Object.assign(runtime.object(receiver), { contextConfiguration: merged, resourceConfigurationDifference: changes });
            runtime.record(`RESOURCES updateConfiguration: the shared Resources now select for a changed configuration (delta=0x${(changes >>> 0).toString(16)})`);
            return this.updateOverrideConfiguration(runtime, receiver, incoming, metricsArg);
          }
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
        const identity = table?.entries.get(id)?.[0]; if (!identity) this.resourceNotFound(runtime, id, this.resources.resolve(id), `Unable to find resource ID #0x${id.toString(16)}`);   // ResourcesImpl.getResourceName/PackageName/TypeName/EntryName
        return identity[{ getResourceName: 'fullName', getResourcePackageName: 'packageName', getResourceEntryName: 'name', getResourceTypeName: 'resourceType' }[name]];
      }
      if (name === 'getStringArray' || name === 'getTextArray' || name === 'getIntArray') {   // Resources.getStringArray / getTextArray / getIntArray over a <string-array> / <integer-array> bag
        if (!this.resources) error('Resources are unavailable', { kind: 'resource-unsupported', resourceId: args[1] });
        let bag = this.resources.resolve(args[1]); while (bag.resolved) bag = bag.resolved;   // an <item type="array"> alias names another array
        if (bag.kind !== 'bag') this.resourceNotFound(runtime, args[1], bag, `${{ getStringArray: 'String array', getTextArray: 'Text array', getIntArray: 'Int array' }[name]} resource ID #0x${(args[1] >>> 0).toString(16)}`);   // Resources.getStringArray / getTextArray / getIntArray
        const items = bag.items.map(item => { return item.dataType === 1 ? this.resource(item.rawData) : item; });
        if (name === 'getIntArray') { const array = runtime.newArray('[I', items.length); runtime.array(array).elements = items.map(item => item.rawData | 0); return array; }
        const text = item => (item.kind === 'string' ? item.value : item.dataType === 0x12 ? ((item.rawData | 0) !== 0 ? 'true' : 'false') : item.dataType >= 0x10 && item.dataType <= 0x1f ? String(item.rawData | 0) : null);
        const array = runtime.newArray(name === 'getTextArray' ? '[Ljava/lang/CharSequence;' : '[Ljava/lang/String;', items.length); runtime.array(array).elements = items.map(text); return array;
      }
      // an id of the app's package that no installed resources.arsc defines (base and every split given to the loader): Resources.NotFoundException with ResourcesImpl's
      // message (getText: "String resource ID #0x..", the getValue paths: "Resource ID #0x.."), which the app may catch, as on a device
      const probe = this.resources?.resolve(args[1]) ?? null;
      { if (probe?.kind === 'unresolved' && probe.absent) {
          const hex = (Number(args[1]) >>> 0).toString(16);
          runtime.record(`RESOURCES Resources.${name}(0x${hex}): no installed resources.arsc of the package defines it (Resources.NotFoundException)`);
          runtime.throwJava('Landroid/content/res/Resources$NotFoundException;', name === 'getString' || name === 'getText' ? `String resource ID #0x${hex}` : `Resource ID #0x${hex}`);
        } }
      if (name === 'getString' || name === 'getText') return this.stringResource(runtime, args[1]);
      const resource = this.resource(args[1], undefined, null, runtime, probe);
      // Resources.getColor of a color state list (res/color/*.xml): ResourcesImpl.loadColorStateList, then its default color (Resources.getColor(int, Theme))
      if (name === 'getColor' && resource.kind === 'string' && /\.xml$/.test(resource.value ?? '')) { const list = this.styleBackend.loadColor(runtime, args[1], method.parameters.length > 1 ? args[2] ?? null : null); return runtime.dispatch({ owner: 'Landroid/content/res/ColorStateList;', name: 'getDefaultColor', parameters: [], result: 'I', signature: '()I' }, [list], 'virtual'); }
      // Resources.getFraction(id, base, pbase): a fraction value, through the original TypedValue.complexToFraction (x% of base, x%p of pbase)
      if (name === 'getFraction') { let value = resource; while (value.resolved) value = value.resolved; if (value.kind !== 'fraction') runtime.throwJava('Landroid/content/res/Resources$NotFoundException;', `Resource ID #0x${(args[1] >>> 0).toString(16)} type #0x${(value.dataType ?? 0).toString(16)} is not valid`); return runtime.dispatch({ owner: 'Landroid/util/TypedValue;', name: 'complexToFraction', signature: '(IFF)F', parameters: ['I', 'F', 'F'], result: 'F' }, [value.rawData, floatBits(args[2]), floatBits(args[3])], 'static'); }
      // Resources.getInteger / getBoolean / getColor accept any TYPE_FIRST_INT..TYPE_LAST_INT value (0x10..0x1f: integers, booleans, colors), the getDimension family only a
      // TYPE_DIMENSION; anything else is NotFoundException("Resource ID #0x.. type #0x.. is not valid") (android-13.0.0_r1 Resources.java).
      let leaf = resource; while (leaf.resolved) leaf = leaf.resolved;   // the value at the end of an alias chain (@color/a -> @color/b): its type and data
      const integral = leaf.dataType >= 0x10 && leaf.dataType <= 0x1f, dimension = leaf.dataType === 5;
      if (['getInteger', 'getBoolean', 'getColor'].includes(name) ? !integral : name.startsWith('getDimension') ? !dimension : false) this.resourceNotFound(runtime, args[1], leaf, `Resource ID #0x${(args[1] >>> 0).toString(16)} type #0x${(leaf.dataType ?? 0).toString(16)} is not valid`);
      if (!['getInteger', 'getBoolean', 'getColor', 'getDimension', 'getDimensionPixelSize', 'getDimensionPixelOffset'].includes(name)) error(`Resources.${name} is not installed (resource 0x${(args[1] >>> 0).toString(16)} is a ${resource.kind})`);
      if (name === 'getBoolean') return (leaf.rawData | 0) !== 0 ? 1 : 0;
      if (name === 'getColor' || name === 'getInteger') return leaf.rawData | 0;
      if ((runtime.classes || runtime.dex.classes).has('Landroid/util/TypedValue;') && name.startsWith('getDimension')) return this.aospDimension(runtime, leaf, { getDimension: 'complexToDimension', getDimensionPixelSize: 'complexToDimensionPixelSize', getDimensionPixelOffset: 'complexToDimensionPixelOffset' }[name]);
      if (name === 'getDimension') return floatBits(leaf.value);
      if (name === 'getDimensionPixelSize') return Math.round(leaf.value);
      if (name === 'getDimensionPixelOffset') return Math.trunc(leaf.value);
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
        this.viewGroupApi.transitionRemoveChild(runtime, receiver, args[1]);   // "if (mTransition != null) mTransition.removeChild(this, view)": its DISAPPEARING animation keeps the view as a transitioning one
        const child = runtime.object(args[1]), disappearing = this.viewGroupApi.keepsDisappearing(runtime, receiver, args[1]);   // ViewGroup.removeViewInternal: a running Animation / view transition keeps the child attached and drawn until it ends
        if (child.attached) { this.viewWindowHost.unfocusSubtree(runtime, args[1]); if (!disappearing) this.attachTree(runtime, args[1], false); }
        const index = object.children.findIndex(value => sameRef(value, args[1])); if (index < 0) return; object.children.splice(index, 1); if (disappearing) this.viewGroupApi.addDisappearing(runtime, receiver, args[1]);
        if (sameRef(child.parent, receiver) && !(object.vg?.transitioning ?? []).some(view => sameRef(view, args[1]))) child.parent = null;
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewRemoved', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); this.notifyHierarchyChange(runtime, receiver, args[1], false); this.requestDraw(runtime, receiver); if (object.laidOut && name !== 'removeViewInLayout') this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]); return;
      }
      if (name === 'addView' || name === 'addViewInLayout') {
        const inLayout = name === 'addViewInLayout', preventLayout = inLayout && !!args[4];
        // ViewGroup.addView(View, int width, int height): generateDefaultLayoutParams() with that size, then the virtual addView(View, -1, LayoutParams).
        if (!inLayout && method.signature === '(Landroid/view/View;II)V') {
          const params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateDefaultLayoutParams', signature: '()Landroid/view/ViewGroup$LayoutParams;', parameters: [], result: LAYOUT_PARAMS }, [receiver], 'virtual');
          if (nullish(params)) runtime.throwJava('Ljava/lang/NullPointerException;', 'generateDefaultLayoutParams() returned null');
          const fields = runtime.object(params).fields; runtime.storeField(fields, `${LAYOUT_PARAMS}->width:I`, args[2]); runtime.storeField(fields, `${LAYOUT_PARAMS}->height:I`, args[3]);
          runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'addView', signature: `(Landroid/view/View;I${LAYOUT_PARAMS})V`, parameters: ['Landroid/view/View;', 'I', LAYOUT_PARAMS], result: 'V' }, [receiver, args[1], -1, params], 'virtual'); return;
        }
        // ViewGroup.addView(View) / (View, int) / (View, LayoutParams) end in the virtual addView(View, int, LayoutParams): a subclass that overrides it (RadioGroup tracks a checked
        // child there, ScrollView refuses a second one, an app's own container) sees every child. The layout params are the child's own or generateDefaultLayoutParams().
        if (!inLayout && method.parameters && method.parameters.length <= 2 && runtime.objectOverride(object.type, `addView(Landroid/view/View;I${LAYOUT_PARAMS})V`)) {
          const byIndex = method.parameters?.[1] === 'I', index = byIndex ? args[2] : -1; let params = method.parameters?.[1] === LAYOUT_PARAMS ? args[2] : null;
          if (method.parameters?.[1] !== LAYOUT_PARAMS) {
            if (nullish(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot add a null child view to a ViewGroup');
            params = runtime.object(args[1]).layoutParams ?? null;
            if (nullish(params)) params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateDefaultLayoutParams', signature: '()Landroid/view/ViewGroup$LayoutParams;', parameters: [], result: LAYOUT_PARAMS }, [receiver], 'virtual');
            if (nullish(params)) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'generateDefaultLayoutParams() cannot return null  ');
          }
          runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'addView', signature: `(Landroid/view/View;I${LAYOUT_PARAMS})V`, parameters: ['Landroid/view/View;', 'I', LAYOUT_PARAMS], result: 'V' }, [receiver, args[1], index, params], 'virtual'); return;
        }
        if (inLayout && nullish(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot add a null child view to a ViewGroup');
        if (inLayout) runtime.object(args[1]).parent = null;
        this.viewGroupApi.transitionCancelDisappearing(runtime, receiver);   // ViewGroup.addViewInner: "cancel remove transitions to let them complete the process before we add to the container"
        const child = runtime.object(args[1]); if (child.parent) runtime.throwJava('Ljava/lang/IllegalStateException;', 'View already has a parent');
        const indexed = method.parameters?.[1] === 'I', at = indexed && args[2] >= 0 ? args[2] : object.children.length; if (at > object.children.length) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child index');
        let params = indexed ? args[3] : args[2]; params ||= child.layoutParams;
        if (!params) params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateDefaultLayoutParams', signature: '()Landroid/view/ViewGroup$LayoutParams;', parameters: [], result: LAYOUT_PARAMS }, [receiver], 'virtual');
        let fits; try { fits = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'checkLayoutParams', signature: `(${LAYOUT_PARAMS})Z`, parameters: [LAYOUT_PARAMS], result: 'Z' }, [receiver, params], 'virtual'); }
        catch (failure) { const recovered = this.recoverLayoutParams(runtime, receiver, params, failure); if (recovered === undefined) throw failure; params = recovered; fits = true; }   // a layout_* value of the child's tag that the parent refuses
        if (!fits) params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateLayoutParams', signature: `(${LAYOUT_PARAMS})${LAYOUT_PARAMS}`, parameters: [LAYOUT_PARAMS], result: LAYOUT_PARAMS }, [receiver, params], 'virtual');   // ViewGroup.addViewInner
        this.invoke(runtime, { owner: 'Landroid/view/View;', name: 'setLayoutParams' }, [args[1], params]);
        this.viewGroupApi.transitionAddChild(runtime, receiver, args[1]);   // ViewGroup.addViewInner: "mTransition.addChild(this, child)" before the child joins mChildren
        child.parent = receiver; object.children.splice(at, 0, args[1]);
        if (object.attached) this.attachTree(runtime, args[1], true);
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
    if (name === 'getParent') {
      if (object.parent) return object.parent;
      // The root View of a window added through WindowManager.addView has its ViewRootImpl as parent (a ViewParent that is not a View) while the window exists; PopupWindow
      // tells an added decor from a removed one by it (dismissImmediate: "if (decorView.getParent() != null) removeViewImmediate").
      const record = object.attached ? this.dialogWindowHost.recordFor(runtime, receiver) : null;
      if (!record?.attached || !sameRef(record.root, receiver)) return null;
      const impl = runtime.dispatch({ owner: 'Landroid/view/View;', name: 'getViewRootImpl', parameters: [], result: 'Landroid/view/ViewRootImpl;', signature: '()Landroid/view/ViewRootImpl;' }, [receiver], 'virtual');
      if (impl) runtime.object(impl).windowRootView = receiver;
      return impl ?? null;
    }
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
    if (name === 'setLayoutParams') { if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', 'Layout parameters cannot be null'); object.layoutParams = args[1]; runtime.storeField(object.fields, 'Landroid/view/View;->mLayoutParams:Landroid/view/ViewGroup$LayoutParams;', args[1]);
      // View.resolveLayoutParams runs on every setLayoutParams, whatever the direction: a LayoutParams class that overrides resolveLayoutDirection derives state from it even in
      // left-to-right (RelativeLayout.LayoutParams resolves its start / end rules into left / right ones; androidx ConstraintLayout.LayoutParams fills its resolved*To* anchors and
      // bias, which its onMeasure reads before the child's own measure: unresolved, every horizontal constraint is UNSET and each child sits at x = 0).
      const params = runtime.object(args[1]); if ((params.marginState && (object.layoutDirection || 0) !== params.marginState.dir) || (runtime.classes.has(RELATIVE_PARAMS) && runtime.isSubtype(params.type, RELATIVE_PARAMS)) || overridesResolveLayoutDirection(runtime, params.type)) { runtime.dispatch({ owner: MARGIN_PARAMS, name: 'resolveLayoutDirection', signature: '(I)V', parameters: ['I'], result: 'V' }, [args[1], object.layoutDirection || 0], 'virtual'); params.resolvedDirection = object.layoutDirection || 0; }   // View.resolveLayoutParams
      const fields = params.fields; const read = (name, type, fallback) => [...fields].find(([key]) => key.endsWith(`->${name}:${type}`))?.[1] ?? fallback; object.layoutWidth = read('width', 'I', -2); object.layoutHeight = read('height', 'I', -2); object.weight = bitsFloat(read('weight', 'F', 0)); object.layoutGravity = read('gravity', 'I', 0); object.margin = Object.fromEntries(['left', 'top', 'right', 'bottom'].map(edge => [edge, read(`${edge}Margin`, 'I', 0)])); this.drawableViewHost.afterLayout(runtime, receiver);
      // View.setLayoutParams: "if (mParent instanceof ViewGroup) ((ViewGroup) mParent).onSetLayoutParams(this, params)" -- GridLayout drops its cached structure there. ViewGroup's own body
      // only requests a layout; the dispatch is made for a parent class that overrides it.
      if (method.parameters && object.parent && runtime.objectOverride(runtime.object(object.parent).type, `onSetLayoutParams(Landroid/view/View;${LAYOUT_PARAMS})V`)) runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onSetLayoutParams', signature: `(Landroid/view/View;${LAYOUT_PARAMS})V`, parameters: ['Landroid/view/View;', LAYOUT_PARAMS], result: 'V' }, [object.parent, receiver, args[1]], 'virtual');
      if (method.parameters) runtime.dispatch({ owner: 'Landroid/view/View;', name: 'requestLayout', signature: '()V', parameters: [], result: 'V' }, [receiver], 'virtual');   // View.setLayoutParams ends in requestLayout()
      return; }
    if (name === 'getLayoutParams') return object.layoutParams ?? null;
    if (name === 'setTag') { if (method.parameters.length === 1) object.tag = args[1]; else (object.keyedTags ||= new Map()).set(args[1], args[2]); return; }
    if (name === 'getTag') return method.parameters.length ? object.keyedTags?.get(args[1]) ?? null : object.tag ?? null;
    if (name === 'getVisibility') return object.visibility ?? 0;
    if (name === 'setVisibility') {
      if (![0, 4, 8].includes(args[1])) error('Invalid View visibility');
      const before = object.visibility ?? 0; object.visibility = args[1]; if (before === args[1]) return;
      // View.setFlags: "((ViewGroup) mParent).onChildVisibilityChanged(this, old, new)" -- GridLayout drops its cached structure when a child crosses GONE. ViewGroup's own body serves
      // its LayoutTransition (showChild / hideChild); the dispatch is made for a parent class that overrides it or a parent with a transition.
      if (object.parent && runtime.isSubtype(runtime.object(object.parent).type, 'Landroid/view/ViewGroup;') && (runtime.objectOverride(runtime.object(object.parent).type, 'onChildVisibilityChanged(Landroid/view/View;II)V') || this.viewGroupApi.hasTransition(runtime, object.parent))) runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onChildVisibilityChanged', signature: '(Landroid/view/View;II)V', parameters: ['Landroid/view/View;', 'I', 'I'], result: 'V' }, [object.parent, receiver, before, args[1]], 'virtual');
      // AOSP View.setVisibility: crossing GONE changes measured size, so the whole ancestor chain must re-measure/re-layout (a view that was GONE was never laid out); any change redraws.
      if ((before === 8) !== (args[1] === 8)) { // only under a hierarchy the original layout engine has already laid out (framework-less legacy rendering has no layout pass)
        let up = receiver, managed = false; for (let depth = 0; up && depth < 4096 && !managed; depth++) { managed = !!runtime.object(up).laidOut; up = runtime.object(up).parent; }
        if (managed) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]);
      }
      this.drawableViewHost.imageVisibility(runtime, receiver); this.requestDraw(runtime, receiver); this.dialogWindowHost.visibilityChanged(runtime, receiver);
      // View.setFlags on an attached view: dispatchVisibilityChanged(this, visibility), then dispatchVisibilityAggregated when the parent is shown.
      if (object.attached) { this.dispatchVisibilityChanged(runtime, receiver, receiver, args[1]); const parent = object.parent; if (parent && (!runtime.isSubtype(runtime.object(parent).type, 'Landroid/view/View;') || this.viewShown(runtime, parent))) this.dispatchVisibilityAggregated(runtime, receiver, args[1] === 0); }
      return;
    }
    if (name === 'setBackgroundColor') {   // View.setBackgroundColor: a ColorDrawable background takes the colour, anything else is replaced by the colour
      const color = 'Landroid/graphics/drawable/ColorDrawable;', held = object.backgroundDrawable || object.backgroundColorDrawable || null;
      if (held && runtime.isSubtype(runtime.typeOf(held), color)) runtime.dispatch({ owner: color, name: 'setColor', signature: '(I)V', parameters: ['I'], result: 'V' }, [held, args[1]], 'virtual');
      if (object.backgroundDrawable && runtime.isSubtype(runtime.typeOf(object.backgroundDrawable), color)) return;
      if (object.backgroundDrawable) this.drawableViewHost.invoke(runtime, { owner: 'Landroid/view/View;', name: 'setBackground' }, [receiver, null]);
      object.background = `#${(args[1] >>> 0).toString(16).padStart(8, '0')}`; return;
    }
    if (owner === 'Landroid/widget/ProgressBar;') { if (name === 'setMax') { object.max = Math.max(0, args[1]); object.progress = Math.min(object.progress || 0, object.max); return; } if (name === 'getMax') return object.max ?? 100; if (name === 'setProgress') { object.progress = Math.max(0, Math.min(object.max ?? 100, args[1])); return; } if (name === 'getProgress') return object.progress ?? 0; if (name === 'setIndeterminate') { object.indeterminate = !!args[1]; return; } return object.indeterminate ? 1 : 0; }
    if (name === 'setOnCheckedChangeListener') { object.checkedListener = args[1]; return; }
    if (name === 'setOnCheckedChangeWidgetListener') { object.checkedWidgetListener = args[1]; return; }   // CompoundButton's hidden second listener: the one RadioGroup tracks its children with
    // CompoundButton.toggle() is setChecked(!mChecked), a virtual call: a subclass's setChecked (ToggleButton syncs its text, an app's own button) runs.
    if (name === 'toggle') { runtime.dispatch({ owner: 'Landroid/widget/CompoundButton;', name: 'setChecked', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [receiver, object.checked ? 0 : 1], 'virtual'); return; }
    if (name === 'setChecked') return this.setChecked(runtime, receiver, !!args[1]);
    if (runtime.isSubtype(object.type, 'Landroid/widget/CompoundButton;')) {
      // CompoundButton.getButtonStateDescription / setDefaultStateDescription / setStateDescription (android-13.0.0_r1): the state description is the app's own one or, without it,
      // the framework's "checked" / "not checked" string (a subclass such as ToggleButton answers its own text). The default is the button's current answer: it is read when the
      // description is asked for, not stored at every setChecked.
      if (name === 'getButtonStateDescription') {
        const id = runtime.readStatic({ owner: 'Lcom/android/internal/R$string;', name: object.checked ? 'checked' : 'not_checked', type: 'I' });
        const resources = runtime.dispatch({ owner: 'Landroid/view/View;', name: 'getResources', signature: '()Landroid/content/res/Resources;', parameters: [], result: 'Landroid/content/res/Resources;' }, [receiver], 'virtual');
        return runtime.dispatch({ owner: 'Landroid/content/res/Resources;', name: 'getString', signature: '(I)Ljava/lang/String;', parameters: ['I'], result: 'Ljava/lang/String;' }, [resources, id], 'virtual');
      }
      if (name === 'setDefaultStateDescription') return;
      if (name === 'getStateDescription') return nullish(object.customStateDescription) ? runtime.dispatch({ owner: 'Landroid/widget/CompoundButton;', name: 'getButtonStateDescription', signature: '()Ljava/lang/CharSequence;', parameters: [], result: 'Ljava/lang/CharSequence;' }, [receiver], 'virtual') : object.customStateDescription;
      if (name === 'setStateDescription') { object.customStateDescription = nullish(args[1]) ? null : args[1]; return; }
    }
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
    if (name === 'setTransformationMethod') {
      object.transformationMethod = args[1];
      // TextView.setTransformationMethod: a TransformationMethod2 (AllCapsTransformationMethod) only transforms once the TextView allowed length changes, which it does unless the text is selectable or an Editable
      const TM2 = 'Landroid/text/method/TransformationMethod2;';
      if (!nullish(args[1]) && runtime.classes.has(TM2) && runtime.isSubtype(runtime.object(args[1]).type, TM2)) {
        const text = runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'getText', signature: '()Ljava/lang/CharSequence;', parameters: [], result: 'Ljava/lang/CharSequence;' }, [receiver], 'virtual');
        const editable = runtime.isSubtype(object.type, 'Landroid/widget/EditText;') || !nullish(text) && typeof text !== 'string' && runtime.isSubtype(runtime.object(text).type, 'Landroid/text/Editable;');
        const selectable = !!runtime.dispatch({ owner: 'Landroid/widget/TextView;', name: 'isTextSelectable', signature: '()Z', parameters: [], result: 'Z' }, [receiver], 'virtual');
        runtime.dispatch({ owner: runtime.object(args[1]).type, name: 'setLengthChangesAllowed', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [args[1], !selectable && !editable ? 1 : 0], 'virtual');
      }
      this.updateTextTransformation(runtime, receiver); this.requestDraw(runtime, receiver); return;
    }
    if (name === 'setHint') { object.hint = args[1] ?? ''; return; } if (name === 'getHint') return object.hint ?? null;
    if (name === 'getId') return object.androidId ?? -1;
    if (name === 'setId') { object.androidId = args[1] >>> 0; return; }
    if (name === 'findViewById') return this.find(runtime, receiver, args[1]);
    if (name === 'getContext') return object.context ?? runtime.activity;
    if (name === 'setEnabled') { if (object.enabled !== !!args[1]) { object.enabled = !!args[1]; this.drawableViewHost.invoke(runtime, { owner: 'Landroid/view/View;', name: 'refreshDrawableState' }, [receiver]); this.requestDraw(runtime, receiver); } return; }
    if (name === 'isEnabled') return object.enabled === false ? 0 : 1;
    if (name === 'setPadding') {
      // View.setPadding: the relative padding is undefined again, left / right are the new user padding "initial" values, then the virtual internalSetPadding(): a subclass that
      // overrides it (CheckedTextView keeps the padding its check mark is added to) is told; View's own adds the scroll bar's size for an inset scroll bar style.
      object.userPaddingStart = object.userPaddingEnd = -2147483648;
      if (runtime.objectOverride(object.type, 'internalSetPadding(IIII)V')) { this.syncViewFields(runtime, receiver); object.userPaddingLeftInitial = args[1]; object.userPaddingRightInitial = args[3]; runtime.dispatch({ owner: 'Landroid/view/View;', name: 'internalSetPadding', signature: '(IIII)V', parameters: ['I', 'I', 'I', 'I'], result: 'V' }, [receiver, args[1], args[2], args[3], args[4]], 'virtual'); return; }
      const inset = this.viewXmlAttributes?.scrollbarInsets(runtime, receiver) ?? { left: 0, right: 0, bottom: 0 };
      object.padding = { left: args[1] + inset.left, top: args[2], right: args[3] + inset.right, bottom: args[4] + inset.bottom }; object.userPaddingLeftInitial = args[1]; object.userPaddingRightInitial = args[3]; this.syncViewFields(runtime, receiver); return;
    }
    if (name.startsWith('getPadding')) return object.padding?.[name.slice(10).toLowerCase()] ?? 0;
    if (name === 'getText') { if (runtime.isSubtype(object.type, 'Landroid/widget/EditText;')) { const editable = this.editableTextHost.get(runtime, receiver); if (editable) return editable; } if (method.result === 'Landroid/text/Editable;') { if (!object.editable) { object.editable = runtime.makeObject(EDITABLE); runtime.object(object.editable).sourceView = receiver; } return object.editable; } return object.text; }
    if (name === 'setText') { const text = method.parameters[0] === 'I' ? args[1] === 0 ? '' : this.stringResource(runtime, args[1]) : nullish(args[1]) ? '' : typeof args[1] === 'string' ? args[1] : runtime.javaString(args[1], method.parameters[0]); return this.setInput(runtime, object.id, text, { replaceBuffer: true, sourceValue: method.parameters[0] === 'I' ? text : args[1] ?? '' }); }
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
    this.unreadableEntry(runtime, entry);
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
    if (name === '<init>') { const copy = method.parameters[0] === BUNDLE || method.parameters[0] === 'Landroid/os/PersistableBundle;'; object.extras = copy ? new Map(this.extras(runtime, args[1])) : new Map(); object.classLoader = copy ? runtime.object(args[1]).classLoader ?? null : null; return; }
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
      this.unreadableEntry(runtime, entry);
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
    this.noteInput(); const receiver = { ref: id }, view = runtime.object(receiver);
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
    // CompoundButton.setChecked: the app's listener, then the widget listener (RadioGroup's), never re-entered from a listener.
    if (view.broadcasting || nullish(view.checkedListener) && nullish(view.checkedWidgetListener)) return;
    view.broadcasting = true;
    try { for (const listener of [view.checkedListener, view.checkedWidgetListener]) if (!nullish(listener)) runtime.dispatch({ owner: runtime.object(listener).type, name: 'onCheckedChanged', signature: '(Landroid/widget/CompoundButton;Z)V', parameters: ['Landroid/widget/CompoundButton;', 'Z'], result: 'V' }, [listener, receiver, checked ? 1 : 0], 'virtual'); }
    finally { view.broadcasting = false; }
  }
  /** CompoundButton.toggle() through the receiver's class: RadioButton.toggle() leaves a checked button checked, ToggleButton.setChecked() swaps its text. */
  toggleChecked(runtime, receiver) { runtime.dispatch({ owner: 'Landroid/widget/CompoundButton;', name: 'toggle', signature: '()V', parameters: [], result: 'V' }, [receiver], 'virtual'); }
  performClick(runtime, receiver) {
    const view = runtime.object(receiver); if (!runtime.isSubtype(view.type, 'Landroid/widget/CompoundButton;')) return false;
    this.toggleChecked(runtime, receiver);
    if (!nullish(view.listener)) runtime.dispatch({ owner: runtime.object(view.listener).type, name: 'onClick', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [view.listener, receiver], 'virtual');
    return true;
  }
  checkInput(runtime, id, checked) {
    this.noteInput(); const receiver = { ref: id }, view = runtime.object(receiver);
    if (!runtime.isSubtype(view.type, 'Landroid/widget/CompoundButton;') || view.enabled === false) error('Invalid disabled/non-CompoundButton input');
    if (!!view.checked !== !!checked) this.toggleChecked(runtime, receiver);   // the page's tap: CompoundButton.performClick() toggles
    if (!nullish(view.listener)) runtime.dispatch({ owner: runtime.object(view.listener).type, name: 'onClick', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [view.listener, receiver], 'virtual');
  }
  attachTree(runtime, ref, attached, seen = new Set(), visibility = null) {
    if (!ref) return; const object = runtime.object(ref);
    // The visibility View.dispatchAttachedToWindow(info, visibility) receives: 0 for a window's root (ViewRootImpl), the parent's own visibility for a child added to an attached parent
    // (ViewGroup.addViewInner), and combineVisibility(the parent's value, the child's own) = the larger one for everything ViewGroup.dispatchAttachedToWindow reaches below.
    if (attached && visibility === null) { const parent = object.parent && runtime.object(object.parent); visibility = parent && runtime.isSubtype(parent.type, 'Landroid/view/View;') ? parent.visibility ?? 0 : 0; }
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
      // View.dispatchDetachedFromWindow: the window is gone for the view (onWindowVisibilityChanged(GONE), onVisibilityAggregated(false)) before onDetachedFromWindow.
      if (!attached) { this.visibilityCallback(runtime, ref, 'onWindowVisibilityChanged', '(I)V', ['I'], [8]); if (this.viewShown(runtime, ref)) this.visibilityCallback(runtime, ref, 'onVisibilityAggregated', '(Z)V', ['Z'], [0]); }
      runtime.dispatch({ owner: object.type, name: attached ? 'onAttachedToWindow' : 'onDetachedFromWindow', signature: '()V', parameters: [], result: 'V' }, [ref], 'virtual');
      this.drawableViewHost.afterAttach(runtime, ref, attached);
      this.progressBarApi.afterAttach(runtime, ref, attached);
      // View.dispatchAttachedToWindow / dispatchDetachedFromWindow: "if (mOverlay != null) mOverlay.getOverlayView().dispatch..."
      if (object.overlay) { const group = this.viewApi.overlayView(runtime, ref); if (group) this.attachTree(runtime, group, attached, seen, attached ? object.visibility ?? 0 : null); }
      this.viewTreeHost.afterAttach(runtime, ref, attached);
      for (const listener of [...(object.attachListeners || [])]) runtime.dispatch({ owner: runtime.object(listener).type, name: attached ? 'onViewAttachedToWindow' : 'onViewDetachedFromWindow', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [listener, ref], 'virtual');
      // View.dispatchAttachedToWindow, after onAttachedToWindow and the attach listeners: the window's visibility, then the aggregated one for a shown view.
      // Then onVisibilityChanged(this, visibility) directly on the view (not dispatchVisibilityChanged: the subtree is attached view by view and each one gets its own call).
      if (attached) {
        this.visibilityCallback(runtime, ref, 'onWindowVisibilityChanged', '(I)V', ['I'], [0]); if (this.viewShown(runtime, ref)) this.visibilityCallback(runtime, ref, 'onVisibilityAggregated', '(Z)V', ['Z'], [1]);
        this.visibilityCallback(runtime, ref, 'onVisibilityChanged', '(Landroid/view/View;I)V', ['Landroid/view/View;', 'I'], [ref, visibility]);
      }
      if (!attached) object.attached = false;
    }
    if (attached) for (const child of [...object.children]) this.attachTree(runtime, child, true, seen, Math.max(visibility ?? 0, runtime.object(child).visibility ?? 0));
  }
  // The visibility callbacks of View (onWindowVisibilityChanged, onVisibilityChanged, onVisibilityAggregated) reach the classes that override them: a Chronometer or TextClock starts and
  // stops its ticking there, an app's own View its animation. View's own bodies are hooks whose effects (drawable visibility, scroll bars) the lab applies where the state changes.
  visibilityCallback(runtime, ref, name, signature, parameters, values) {
    const type = runtime.object(ref).type; if (!runtime.objectOverride(type, name + signature)) return;
    runtime.dispatch({ owner: type, name, signature, parameters, result: 'V' }, [ref, ...values], 'virtual');
  }
  /** View.isShown(): this view and every ancestor View is VISIBLE. */
  viewShown(runtime, ref) {
    for (let current = ref, depth = 0; current && depth < 4096; depth++) { const view = runtime.object(current); if (!runtime.isSubtype(view.type, 'Landroid/view/View;')) break; if ((view.visibility ?? 0) !== 0) return false; current = view.parent; }
    return true;
  }
  /** View / ViewGroup.dispatchVisibilityChanged(changedView, visibility). */
  dispatchVisibilityChanged(runtime, ref, changed, visibility, depth = 0) {
    this.visibilityCallback(runtime, ref, 'onVisibilityChanged', '(Landroid/view/View;I)V', ['Landroid/view/View;', 'I'], [changed, visibility]);
    if (depth < 4096) for (const child of [...(runtime.object(ref).children ?? [])]) this.dispatchVisibilityChanged(runtime, child, changed, visibility, depth + 1);
  }
  /** View / ViewGroup.dispatchVisibilityAggregated(isVisible): a view that is not VISIBLE hears only "false", and so does everything under it. */
  dispatchVisibilityAggregated(runtime, ref, visible, depth = 0) {
    const view = runtime.object(ref), own = (view.visibility ?? 0) === 0;
    if (own || !visible) this.visibilityCallback(runtime, ref, 'onVisibilityAggregated', '(Z)V', ['Z'], [visible ? 1 : 0]);
    if (depth < 4096) for (const child of [...(view.children ?? [])]) if ((runtime.object(child).visibility ?? 0) === 0) this.dispatchVisibilityAggregated(runtime, child, own && visible, depth + 1);
  }
  notifyActivity(runtime, frame, event, bundle) {
    if (this.companionUi) return this.inFramePackage(runtime, frame, () => this.notifyActivityCallbacks(runtime, frame, event, bundle));
    return this.notifyActivityCallbacks(runtime, frame, event, bundle);
  }
  notifyActivityCallbacks(runtime, frame, event, bundle) {
    const parameters = [ACTIVITY]; const values = [frame.activity];
    if (/(Created|SaveInstanceState)$/.test(event)) { parameters.push(BUNDLE); values.push(bundle || null); }
    // Activity.dispatchActivityX: the callbacks registered on the Activity first (API 29+), then the Application's. The Pre*/Post* callbacks are interface default methods:
    // a callback class that does not declare one gets the empty default.
    const callbacks = [...(runtime.object(frame.activity).activityCallbacks ?? []), ...(frame.packageEntry ? frame.packageEntry.activityCallbacks : this.applicationCallbacks)], name = `onActivity${event}`, signature = `(${parameters.join('')})V`;   // a second package's Activity: its own Application's callbacks
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
    const event = events[name], frame = event && runtime.isSubtype(runtime.object(receiver).type, ACTIVITY) ? this.activityFrame(receiver) : null;
    if (!frame) return run();
    const bundle = /(Created|SaveInstanceState)$/.test(event) ? (values[0] ?? null) : undefined, legacy = runtime.apiLevel < 29;
    frame.lifecycleDepth = (frame.lifecycleDepth ?? 0) + 1;
    let result;
    try {
      if (!legacy) this.notifyActivity(runtime, frame, `Pre${event === 'SaveInstanceState' ? 'SaveInstanceState' : event}`, bundle);
      result = this.inFramePackage(runtime, frame, run);
      if (!legacy) this.notifyActivity(runtime, frame, `Post${event}`, bundle);
    } finally { frame.lifecycleDepth--; }
    if (frame.lifecycleDepth === 0 && frame.finishRequested && !frame.finishing) { frame.finishRequested = false; this.finish(runtime, frame.activity); }
    return result;
  }
  lifecycleCall(runtime, receiver, name, parameters = [], values = []) {
    const activity = runtime.isSubtype(runtime.object(receiver).type, ACTIVITY), frame = activity ? this.activityFrame(receiver) : null;
    const before = { onPause: 3, onStop: 2, onDestroy: 0 };
    if (frame && Object.hasOwn(before, name)) { if (name === 'onDestroy') frame.destroyed = true; this.moveFragments(runtime, frame, before[name]); }
    const result = this.performLifecycle(runtime, receiver, name, values, () => runtime.dispatch({ owner: runtime.object(receiver).type, name, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [receiver, ...values], 'virtual'));
    // ActivityThread.handleDestroyActivity: fragments and Activity.onDestroy run first (Compose disposes its compositions there), the window is removed afterwards.
    if (frame && name === 'onDestroy') { if (frame.root) this.viewWindowHost.unfocusSubtree(runtime, frame.root); this.attachTree(runtime, frame.root, false); this.windowManagerGlobal.activityDestroyed(runtime, frame); this.dialogWindowHost.activityDestroyed(runtime, receiver); this.strictModeActivity(runtime, receiver, 'destroyed'); }
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
    if (this.finishedActivities.has(activity?.ref)) return; const frame = this.frame(runtime, activity); if (frame.lifecycleStage >= 2) return; frame.lifecycleStage = 2; this.activityApi.noteDecorActionBar?.(runtime, activity); this.moveFragments(runtime, frame, 2);
    // ActivityThread checks mFinished after every step of the launch (performLaunchActivity, handleStartActivity, performResumeActivity): an Activity that finished (or was replaced) inside onCreate / onStart /
    // onRestoreInstanceState / onPostCreate is already torn down by then and gets none of the following callbacks.
    const alive = () => this.launchAlive(frame);
    if (!alive()) return; this.lifecycleCall(runtime, activity, 'onStart');
    if (alive() && frame.savedState) this.lifecycleCall(runtime, activity, 'onRestoreInstanceState', [BUNDLE], [frame.savedState]);
    if (alive()) this.lifecycleCall(runtime, activity, 'onPostCreate', [BUNDLE], [frame.savedState || null]);
    if (!alive()) return; this.lifecycleCall(runtime, activity, 'onResume');
    // WindowManager.addView of the decor: ViewRootImpl.setView asks for the first traversal. With its layout pass queued, that pass draws the window when it is done
    // (view-layout-host.js): OnGlobalLayoutListener and OnPreDrawListener run after the first measure and layout, as on Android, never on a window not yet laid out.
    if (alive() && runtime.activity && sameRef(runtime.activity, activity)) { this.windowManagerGlobal.activityResumed(runtime, frame, () => this.attachTree(runtime, frame.root, true)); if (!frame.root || !this.viewLayoutHost.layoutQueued(frame.root)) this.viewTreeHost.dispatchFrame(runtime, frame.root, () => { this.drawableViewHost.drawTree(runtime, frame.root); this.composeCanvasHost.renderTree(runtime, frame.root); }); }
  }
  rtNodeState(runtime, handle) { return renderNodeByHandle(runtime, handle); }
  /** Redraw every window: RenderThread animators changed CanvasProperty / RenderNode values that the recorded display lists read at replay. */
  redrawAll(runtime) { for (const { root } of this.viewRoots(runtime)) this.requestDraw(runtime, root); }
  requestDraw(runtime, receiver, delay = 0) {
    const view = runtime.object(receiver); view.invalidated = true; this.composeCanvasHost.markDirty(runtime,receiver);
    if (!view.attached) return;
    if (!runtime.classes.has('Landroid/view/ViewTreeObserver;') && !view.imageDrawable && !view.backgroundDrawable) return;
    const root=this.dialogWindowHost.recordFor(runtime,receiver)?.root||runtime.root;if(!root)return;
    // View.updateDisplayListIfDirty / View.draw(Canvas, ViewGroup, long) call computeScroll() on a view that is drawn again (android-13.0.0_r1): that is where a Scroller / OverScroller
    // animation advances (ScrollView, HorizontalScrollView, an app's own scrolling container) and asks for the next frame with postInvalidateOnAnimation(). An invalidated view whose
    // class overrides computeScroll() gets the call in the frame that draws it. Attached views only, so the window's root keeps them reachable until then.
    if(view.type&&runtime.objectOverride(view.type,'computeScroll()V'))(this.computeScrollPending??=new Map()).set(receiver.ref,receiver);
    this.scheduleTraversal(runtime, root, delay);
  }
  /** Queues the draw of the window whose root is `root` (ViewRootImpl.scheduleTraversals); a window has one queued at most. */
  scheduleTraversal(runtime, root, delay = 0) {
    this.drawRootsQueued??=new Set();if(this.drawRootsQueued.has(root.ref))return;this.drawRootsQueued.add(root.ref);
    // One traversal per vsync (ViewRootImpl.scheduleTraversals posts CALLBACK_TRAVERSAL to Choreographer, so a window is drawn at most once a frame however many invalidates
    // arrive). The lab draws an invalidated window at once, and again at once when input arrived since its last draw, so the answer to a tap, a key or a drag is not held for a
    // vsync; but a window already drawn in the current vsync interval with no input since is drawn again 1 ms after the next vsync, after the Choreographer frame due then (its
    // animation callbacks run first, and what they invalidate joins this draw). No frame is made for it: the drawing time of a draw outside a frame stays what it was.
    // Without this, a draw that invalidates its own window (Compose's overscroll stretch writes its redraw signal while drawing; the snapshot observer then invalidates the
    // layer from a Handler message right after the draw) ran draw after draw with no vsync between them, 13-23 times per display frame (docs/INTERACTION-PERFORMANCE.md
    // section 26). `runtime.drawEveryInvalidate = true` restores the old behavior; `platform.drawsCoalesced` counts the draws moved to the next vsync.
    if(delay<=0&&!runtime.drawEveryInvalidate&&!this.inputSinceDraw){
      const now=this.clock.now(),interval=vsyncIndex(now);
      if(runtime.object(root).drawnInVsync===interval){delay=(interval+1)*VSYNC_MS+1-now;this.drawsCoalesced=(this.drawsCoalesced??0)+1;}
    }
    this.queueTask(() => {
      this.drawRootsQueued.delete(root.ref);
      if(this.taskClosed||!runtime.object(root).attached||!this.viewRoots(runtime).some(value=>sameRef(value.root,root)))return;
      // A traversal lays the window out before its pre-draw listeners and its draw (ViewRootImpl.performTraversals): with a layout pass of this root queued, the frame is the one
      // that pass asks for when it is done (view-layout-host.js), so that OnPreDrawListeners and a LayoutTransition see the new layout, as on Android.
      if(this.viewLayoutHost.layoutQueued(root))return;
      const scrolling=this.computeScrollPending;
      if(scrolling?.size){this.computeScrollPending=null;for(const target of scrolling.values())if(runtime.object(target).attached)runtime.dispatch({owner:'Landroid/view/View;',name:'computeScroll',signature:'()V',parameters:[],result:'V'},[target],'virtual');}
      const draw=()=>{runtime.object(root).drawnInVsync=vsyncIndex(this.clock.now());this.inputSinceDraw=false;this.drawableViewHost.drawTree(runtime,root);this.composeCanvasHost.renderTree(runtime,root);};
      if(runtime.classes.has('Landroid/view/ViewTreeObserver;')){if(!this.viewTreeHost.dispatchFrame(runtime,root,draw)){this.requestDraw(runtime,root,1000/60);return;}}else draw();
      runtime.object(root).invalidated=false;
    },delay,[root],{ui:true});   // the traversal's draw is view-tree work of the app's main thread (ViewRootImpl.performDraw), never a host task served on top of a waiting main thread
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
  /**
   * "Recriar" / "Reabrir" (lab page, player, backends). mode 'recreate': the Activity on top is recreated exactly as Activity.recreate() does it (ActivityThread.handleRelaunchActivity:
   * onPause, onStop, onSaveInstanceState, onRetainNonConfigurationInstance, onDestroy, then a new instance with onCreate(savedState), retained fragments and the same Intent).
   * mode 'reopen': as finish() followed by a start of the same Intent in its place: onPause, onStop, onDestroy without a saved state and not as a configuration change
   * (isChangingConfigurations() is false, so ComponentActivity clears its ViewModelStore), then a new instance with onCreate(null): the screen loads its content again.
   * Both are queued as a main-thread event like recreate(); the rest of the task and the process (Application, static state) stay.
   */
  reloadActivity(runtime, { mode = 'recreate' } = {}) {
    if (mode !== 'recreate' && mode !== 'reopen') error(`Unknown Activity reload mode ${String(mode).slice(0, 40)} (use recreate or reopen)`);
    if (!runtime.activity) error('No running Activity to reload');
    this.syncCurrent(runtime); const frame = this.frame(runtime);
    if (!frame || frame.finished || frame.finishing) error('The current Activity is finishing: nothing to reload');
    if (!frame.recreationPending) { frame.recreationPending = true; this.queueTask(() => this.recreateActivity(runtime, frame, { fresh: mode === 'reopen' }), 0, [frame.activity]); }
    runtime.record(`ACTIVITY reload ${frame.type.slice(1, -1).replaceAll('/', '.')} (${mode})`);
  }
  recreateActivity(runtime, frame, { fresh = false } = {}) {
    if (!this.allFrames().includes(frame)) return; this.syncCurrent(runtime); frame.changingConfiguration = !fresh;
    if (frame.lifecycleStage === 4) this.lifecycleCall(runtime, frame.activity, 'onPause'); if (frame.lifecycleStage !== 2) this.lifecycleCall(runtime, frame.activity, 'onStop'); const saved = fresh ? null : this.bundle(runtime);
    if (!fresh) this.lifecycleCall(runtime, frame.activity, 'onSaveInstanceState', [BUNDLE], [saved]);
    const retained = fresh ? null : runtime.dispatch({ owner: frame.type, name: 'onRetainNonConfigurationInstance', signature: '()Ljava/lang/Object;', parameters: [], result: 'Ljava/lang/Object;' }, [frame.activity], 'virtual');
    const retainedFragments = !fresh && frame.fragmentManager ? runtime.object(frame.fragmentManager).fragments.filter(ref => runtime.object(ref).retained) : [];
    for (const fragment of retainedFragments) runtime.object(fragment).retaining = true;
    this.lifecycleCall(runtime, frame.activity, 'onDestroy');
    const activity = runtime.allocate(frame.type), replacement = { activity, type: frame.type, intent: frame.intent, root: null, retained, lifecycleStage: 0, savedState: saved, record: frame.record, ...(frame.packageEntry ? { packageEntry: frame.packageEntry } : {}), resultReceiver: frame.resultReceiver, resultRequestCode: frame.resultRequestCode, fragmentRequests: frame.fragmentRequests, launchFlags: frame.launchFlags, noHistory: frame.noHistory, overrideTransition: frame.overrideTransition };
    { const task = this.taskOf(frame); task.frames.splice(task.frames.indexOf(frame), 1, replacement); } this.finishedActivities.add(frame.activity.ref);
    if (retainedFragments.length) { const manager = this.fragmentManager(runtime, replacement); runtime.object(manager).fragments = retainedFragments; for (const fragment of retainedFragments) Object.assign(runtime.object(fragment), { host: activity, manager, fragmentStage: 0, skipCreateOnce: true, retaining: false }); }
    runtime.activity = activity; runtime.activityType = frame.type; runtime.root = null; if (frame.packageEntry) runtime.object(activity).packageEntry = frame.packageEntry;
    runtime.dispatch({ owner: frame.type, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [activity], 'direct');
    this.attachActivityContext(runtime, activity);
    this.lifecycleCall(runtime, activity, 'onCreate', [BUNDLE], [saved]); this.afterActivityCreate(runtime, activity); replacement.root = runtime.root;
  }
  locale(runtime, languageTag) {
    this.localeCache ||= new Map();
    // Locale.forLanguageTag never throws: "if the specified language tag contains any ill-formed subtags, the first such subtag and all following subtags are ignored".
    let tag = 'und';
    if (languageTag && languageTag !== 'und') { const parts = String(languageTag).split(/[-_]/); for (let count = parts.length; count > 0; count--) { try { tag = Intl.getCanonicalLocales(parts.slice(0, count).join('-'))[0] ?? 'und'; break; } catch (failure) { if (!(failure instanceof RangeError)) throw failure; } } }
    if (!this.localeCache.has(tag)) { const info = new Intl.Locale(tag), value = runtime.makeObject(LOCALE); runtime.object(value).localeData = { language: info.language === 'und' ? '' : info.language, country: info.region || '', script: info.script || '', variant: '', tag }; this.localeCache.set(tag, value); }
    return this.localeCache.get(tag);
  }
  localeList(runtime, locales) { if (runtime.classes.has(LOCALES)) { const array = runtime.newArray('[Ljava/util/Locale;', locales.length); runtime.object(array).elements = [...locales]; const value = runtime.allocate(LOCALES); runtime.dispatch({ owner: LOCALES, name: '<init>', signature: '([Ljava/util/Locale;)V', parameters: ['[Ljava/util/Locale;'], result: 'V' }, [value, array], 'direct'); return value; } const value = runtime.makeObject(LOCALES); runtime.object(value).locales = [...locales]; return value; }
  /** DisplayMetrics of the Resources being served: a configuration Resources' own, else the device's. */
  metrics(runtime) { return this.activeResources ? this.metricsFor(runtime, this.activeResources) : this.deviceMetrics(runtime); }
  deviceMetrics(runtime) {
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
  /** ActivityInfo of an <activity> of an installed package (the app's or a companion's), as PackageParser fills it from that package's manifest. `flags`: GET_META_DATA (128). */
  activityInfoObject(runtime, entry, declaration, flags) {
    const main = entry.main, packageName = main ? this.packageName : entry.name, manifest = main ? this.manifest : entry.manifest, appInfo = main ? this.applicationInfo(runtime) : this.packages.applicationInfoFor(runtime, entry);
    const info = runtime.makeObject(ACTIVITY_INFO); const put = (name, type, value) => this.infoField(runtime, info, ACTIVITY_INFO, name, type, value);
    put('name', 'Ljava/lang/String;', declaration.name); put('packageName', 'Ljava/lang/String;', packageName); put('applicationInfo', APPLICATION_INFO, appInfo);
    put('configChanges', 'I', Number(declaration.configChanges || 0)); put('screenOrientation', 'I', Number.isFinite(Number(declaration.screenOrientation)) ? Number(declaration.screenOrientation) | 0 : -1); put('theme', 'I', Number(declaration.theme || manifest.application?.theme || 0)); put('exported', 'Z', declaration.exported === true || declaration.exported === 'true' ? 1 : 0); put('parentActivityName', 'Ljava/lang/String;', declaration.parentActivityName || null); put('permission', 'Ljava/lang/String;', declaration.permission || null);
    // ActivityInfo as PackageParser fills it (ComponentInfo.enabled defaults to true, processName to the application's process, taskAffinity to the application's); GET_META_DATA (128) decides whether metaData is filled.
    const number = value => Number.isFinite(Number(value)) ? Number(value) | 0 : 0, isFalse = value => value === false || value === 'false' || value === 0, isTrue = value => value === true || value === 'true' || (Number.isInteger(value) && value !== 0);
    const fieldOf = (owner, name, type) => runtime.object(appInfo).fields.get(runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }).key);
    put('exported', 'Z', (main ? isTrue(declaration.exported) : this.packages.exported(entry, { ...declaration, kind: 'activity', actions: (declaration.filters ?? []).flatMap(filter => filter.actions ?? []) })) ? 1 : 0); put('enabled', 'Z', isFalse(declaration.enabled) ? 0 : 1); put('directBootAware', 'Z', isTrue(declaration.directBootAware) ? 1 : 0);
    put('processName', 'Ljava/lang/String;', declaration.process ? (String(declaration.process).startsWith(':') ? packageName + declaration.process : declaration.process) : fieldOf(APPLICATION_INFO, 'processName', 'Ljava/lang/String;') ?? packageName);
    put('taskAffinity', 'Ljava/lang/String;', declaration.taskAffinity ?? fieldOf(APPLICATION_INFO, 'taskAffinity', 'Ljava/lang/String;') ?? packageName);
    put('labelRes', 'I', typeof declaration.label === 'number' ? declaration.label : 0); put('nonLocalizedLabel', 'Ljava/lang/CharSequence;', typeof declaration.label === 'string' ? declaration.label : null); put('icon', 'I', typeof declaration.icon === 'number' ? declaration.icon : 0);
    for (const attribute of ['launchMode', 'documentLaunchMode', 'softInputMode', 'uiOptions', 'colorMode', 'persistableMode', 'lockTaskLaunchMode', 'maxRecents']) if (declaration[attribute] !== undefined) put(attribute, 'I', number(declaration[attribute]));
    put('metaData', BUNDLE, (flags & 128) !== 0 ? (main ? this.appServices.metaDataBundle(runtime, declaration.metaData ?? []) : this.packages.metaData(runtime, entry, declaration.metaData ?? [])) : null); return info;
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
    for (const [name, value] of Object.entries({ sourceDir: `${code}/base.apk`, publicSourceDir: `${code}/base.apk`, dataDir: data, deviceProtectedDataDir: `/data/user_de/0/${pkg}`, credentialProtectedDataDir: data, nativeLibraryDir: runtime.arm64 ? (runtime.arm64.mount(), `${code}/lib/arm64`) : `${code}/lib/wasm32`, processName: pkg, taskAffinity: pkg })) put(name, 'Ljava/lang/String;', value);
    // FLAG_DEBUGGABLE=2, FLAG_HAS_CODE=4, FLAG_ALLOW_CLEAR_USER_DATA=0x40, FLAG_INSTALLED=1<<23, FLAG_EXTRACT_NATIVE_LIBS=1<<28 (default when extractNativeLibs is not declared false).
    const isFalse = value => value === false || value === 'false' || value === 0, hasCode = !isFalse(app.hasCode);
    put('flags', 'I', (app.debuggable === true || app.debuggable === 'true' || (Number.isInteger(app.debuggable) && app.debuggable !== 0) ? 2 : 0) | (hasCode ? 4 : 0) | 0x40 | (this.viewXmlAttributes?.hasRtlSupport() ? (1 << 22) : 0) /* FLAG_SUPPORTS_RTL: android:supportsRtl */ | (1 << 23) | (isFalse(app.extractNativeLibs) ? 0 : (1 << 28)));
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
  /** Right-to-left layout is what the original FrameLayout / LinearLayout (and the widgets over them) compute; the host containers used without the layouts profile lay out left-to-right only. */
  rtlLayoutAvailable(runtime) { return ['FrameLayout', 'LinearLayout'].every(name => runtime.classes.get(`Landroid/widget/${name};`)?.methods.has('onMeasure(II)V')); }
  /** ApplicationInfo.hasRtlSupport() && targetSdkVersion >= 17 of the Context's application (the loaded app's without a Context): what View.resolveLayoutDirection and MarginLayoutParams require before anything is right-to-left. The negation of View.isRtlCompatibilityMode (view-xml-attributes.js), the one place that decides it. */
  rtlSupported(runtime, context = null) { return !this.viewXmlAttributes.rtlCompatibility(runtime, context); }
  /** What is said once when a View resolves to right-to-left in a run without the original containers (see rtlLayoutAvailable). */
  get rtlNeedsProfile() { return RTL_NEEDS_PROFILE; }
  layoutParamsFromAttributes(runtime, parent, attrs, target = null, context = null, typeOverride = null) {
    const view = parent ? runtime.object(parent) : { context }, linear = !!view.type && runtime.isSubtype(view.type, 'Landroid/widget/LinearLayout;'), frame = !!view.type && runtime.isSubtype(view.type, 'Landroid/widget/FrameLayout;');
    const type = typeOverride || (linear ? 'Landroid/widget/LinearLayout$LayoutParams;' : frame ? 'Landroid/widget/FrameLayout$LayoutParams;' : MARGIN_PARAMS);
    const ref = target || runtime.makeObject(type), fields = runtime.object(ref).fields;
    if (attrs?.ref && runtime.object(attrs).node) (this.layoutParamsSource ??= new WeakMap()).set(runtime.object(ref), { attrs, parser: runtime.object(attrs), node: runtime.object(attrs).node });   // the tag these LayoutParams are read from (recoverLayoutParams)
    // ViewGroup.LayoutParams / MarginLayoutParams(Context, AttributeSet): layout_width, layout_height and every layout_margin* in the original's precedence (view-xml-attributes.js)
    this.viewXmlAttributes.readMarginLayout(runtime, ref, attrs, view.context, (name, value) => runtime.storeField(fields, `${name === 'width' || name === 'height' ? LAYOUT_PARAMS : MARGIN_PARAMS}->${name}:I`, value), type === LAYOUT_PARAMS);
    if (linear || frame) {   // the host LinearLayout / FrameLayout params: layout_gravity, layout_weight
      const names = ['layout_gravity', 'layout_weight'], table = this.resources.frameworkTable || this.resources.table, ids = runtime.newArray('[I', names.length); runtime.object(ids).elements = names.map(name => { const id = table.findId('attr/' + name); if (!id) error(`Framework attribute ID ${name} unavailable`); return id; });
      const array = this.styleBackend.obtain(runtime, this.styleBackend.theme(runtime, view.context), attrs, ids);
      const get = (name, parameters, result, values) => runtime.dispatch({ owner: 'Landroid/content/res/TypedArray;', name, parameters, result, signature: `(${parameters.join('')})${result}` }, [array, ...values], 'virtual');
      try {
        runtime.storeField(fields, `${type}->gravity:I`, get('getInt', ['I', 'I'], 'I', [0, -1]));
        if (linear) runtime.storeField(fields, `${type}->weight:F`, get('getFloat', ['I', 'F'], 'F', [1, 0]));
      } finally { get('recycle', [], 'V', []); }
    }
    return ref;
  }
  inflater(runtime, context, visited = new Set()) {
    const key = context.ref; ephemeronMap(runtime, this.inflaters); if (this.inflaters.has(key)) return this.inflaters.get(key);   // a finished Activity's inflater must not keep its view tree alive
    if (visited.has(key) || visited.size >= 64) error('Cyclic/excessive ContextWrapper inflater chain'); visited = new Set(visited); visited.add(key);
    const source = 'Lcom/android/internal/policy/PhoneLayoutInflater;', original = runtime.classes.has(source), object = runtime.object(context);
    if (original && object.baseContext && !runtime.isSubtype(object.type, ACTIVITY)) {
      const base = this.inflater(runtime, object.baseContext, visited), inflater = runtime.dispatch({ owner: INFLATER, name: 'cloneInContext', signature: '(Landroid/content/Context;)Landroid/view/LayoutInflater;', parameters: ['Landroid/content/Context;'], result: INFLATER }, [base, context], 'virtual');
      runtime.object(inflater).context = context; this.tagPackageView(runtime, runtime.object(inflater), context); this.inflaters.set(key, inflater); return inflater;
    }
    const inflater = original ? runtime.allocate(source) : runtime.makeObject(INFLATER); runtime.object(inflater).context = context; this.tagPackageView(runtime, runtime.object(inflater), context);
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
    if (name === 'setHasOptionsMenu') { object.hasOptionsMenu = !!args[1]; if (object.hasOptionsMenu) this.noteFrameworkGap(runtime, 'fragment-options-menu', 'android.app.Fragment.setHasOptionsMenu(true): the Activity does not dispatch its options menu to platform Fragments (FragmentController.dispatchCreateOptionsMenu / dispatchPrepareOptionsMenu / dispatchOptionsItemSelected), so Fragment.onCreateOptionsMenu and onOptionsItemSelected are not called'); return; }
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
  /** The delay until the first event that may run while the main thread is parked in a Java wait: host tasks only (looper-host.js nextDueWhileParked). */
  nextParkedEventDelay(now = this.clock.now()) {
    let delay = this.vmRuntime && this.looperHost.started() ? this.looperHost.nextDelayWhileParked(this.vmRuntime, now) : null;
    if (this.externalSources) for (const source of this.externalSources) { const external = source.delay(); if (external !== null && (delay === null || external < delay)) delay = external; }   // a network exchange that made progress wakes the wait as before
    return delay;
  }
  nextEventDelay(now = this.clock.now()) {
    if (this.vmRuntime?.debugger?.mainHeld) return null;   // the debugger suspends the main thread (src/debugger.js): none of its events runs until it is resumed
    const engine = this.vmRuntime?.wasm;   // the main thread's suspended event: 0 once it can go on (the pump resumes it); meanwhile only what may run while main is parked
    if (engine?.mainSuspended) return engine.suspendedReady() ? 0 : this.nextParkedEventDelay(now);
    let delay = this.looperHost.nextDelay(now);
    if (this.externalSources) for (const source of this.externalSources) { const external = source.delay(); if (external !== null && (delay === null || external < delay)) delay = external; }   // e.g. a network exchange that made progress
    return delay;
  }
  /** Registers a source of work that completes outside the VM (network I/O): `delay()` is 0 when it has progress to deliver, `pending()` counts exchanges still in flight. */
  addExternalSource(source) { (this.externalSources ??= new Set()).add(source); }
  /** What the pump is about to run, in words: for the busy watchdog and the reports. */
  /** describeEvent with what the message carries: its Runnable's class, or its `what`, or a Choreographer frame. */
  describeDispatch(runtime, event) {
    if (event.suspendedResume) return 'the main thread\'s suspended event, resumed';
    if (event.platformTask) return `host task ${event.platformTask.name || '(anonymous)'}`;
    if (event.windowFrameTime !== undefined) return 'frame (Choreographer)';
    try {
      const dotted = type => String(type).slice(1, -1).replaceAll('/', '.'), callback = this.looperHost.callbackOf(runtime, event.message);
      return `Handler ${dotted(runtime.typeOf(event.handler))} → ${callback ? dotted(runtime.typeOf(callback)) : 'what=' + this.looperHost.whatOf(runtime, event.message)}`;
    } catch { return this.describeEvent(runtime, event); }
  }
  describeEvent(runtime, event) {
    if (event.suspendedResume) return 'the main thread\'s suspended event, resumed';
    if (event.platformTask) return `host task ${event.platformTask.name || '(anonymous)'}`;
    try { return `Handler ${String(runtime.typeOf(event.handler)).slice(1, -1).replaceAll('/', '.')}`; } catch { return 'Handler message'; }
  }
  /** An input was delivered to the app (the page's click, pointer, text, scroll or semantics action): the main thread is in motion for GC_INPUT_SETTLE_MS (mainThreadMotion). */
  noteInput() {
    this.inputSinceDraw = true;   // the next draw of an invalidated window answers input: it is not held for the vsync (scheduleTraversal)
    const now = performance.now();
    if (this.lastInputAt === undefined || now - this.lastInputAt > INTERACTION_GAP_MS) this.interaction = { startedAt: now, inputs: 0, mainMs: 0, mainEvents: 0, longestMain: null, floorMs: 0, sliceMs: 0, slices: 0, overruns: 0, longestSlice: null, creditMs: 0, creditHeld: 0, gcMs: 0, endedAt: now,
      threads: {}, idle: {}, idleMs: 0, netSeq: this.vmRuntime?.netLog?.nextSeq ?? null, settledAt: null };
    this.interaction.inputs++; this.lastInputAt = now; this.interaction.settledAt = null;
  }
  /** The screen is ready again (the Worker's ready tracker flipped): an open interaction ends here unless the main thread is still working or its tail is not over. */
  noteSettled(now = performance.now()) { const it = this.interaction; if (it && it.settledAt === null && this.lastInputAt !== undefined && now > this.lastInputAt) it.settledAt = now; }
  /** `ms` the Worker was idle during the interaction, and why (what it waited for: apk-worker.js idleReason). */
  noteIdle(ms, reason) {
    const it = this.interactionWindow(); if (!it || !(ms > 0)) return;
    it.idleMs += ms;
    const key = String(reason ?? 'unknown').slice(0, 160);
    if (key in it.idle || Object.keys(it.idle).length < INTERACTION_KEYS) it.idle[key] = (it.idle[key] ?? 0) + ms; else it.idle['(other)'] = (it.idle['(other)'] ?? 0) + ms;
  }
  /** A background slice of `ms` ran thread `name` during the interaction. */
  noteThreadSlice(window, name, ms) {
    const key = String(name ?? '?').slice(0, 60), entry = window.threads[key] ?? (key in window.threads || Object.keys(window.threads).length < INTERACTION_KEYS * 2 ? (window.threads[key] = { ms: 0, slices: 0 }) : (window.threads['(other)'] ??= { ms: 0, slices: 0 }));
    entry.ms += ms; entry.slices++; window.lastSliceAt = performance.now();
  }
  /** The interaction being measured: from its first input until INTERACTION_TAIL_MS after its last one (null otherwise). */
  interactionWindow(now = performance.now()) {
    const it = this.interaction; if (!it || this.lastInputAt === undefined) return null;
    if (now - this.lastInputAt < INTERACTION_TAIL_MS) return it;
    if (now - it.startedAt >= INTERACTION_MAX_MS) return null;
    if (it.lastMainAt !== undefined && now - it.lastMainAt < INTERACTION_GAP_MS) return it;   // the main thread is still working
    if (it.settledAt !== null) return null;   // the screen was ready again
    if (it.lastSliceAt !== undefined && now - it.lastSliceAt < INTERACTION_GAP_MS) return it;   // background threads are still working toward the next screen
    return it.netSeq !== null && (this.vmRuntime?.netLog?.pendingSince?.(it.netSeq) ?? 0) > 0 ? it : null;   // a request made since the input has no answer yet
  }
  /** What the last interaction cost, for the diagnostics summary (src/report-summary.js): the main thread's events, the background slices by kind, the longest of each. */
  interactionStats() { return this.interaction ? { ...this.interaction, sinceLastInputMs: performance.now() - this.lastInputAt } : null; }
  /**
   * Why the main thread is in motion right now, for the collector's deferral (heap-gc.js collectionDue), or null when it is idle: a Choreographer frame is running ('frame-running': the VM clock
   * is frozen at its vsync) or pending ('frame-pending': an animation, a traversal, a ripple), an input was delivered in the last GC_INPUT_SETTLE_MS ('input'), or the main Looper has a message
   * due now ('events-due': the thread is about to run it, not to block). Idle = MessageQueue.next about to block with nothing pending: the tail of drainEvents runs a deferred collection there.
   */
  mainThreadMotion() {
    if (this.clock.frozenAt !== null) return 'frame-running';
    if ((this.viewWindowHost?.framesPending?.() ?? 0) > 0) return 'frame-pending';
    if (this.lastInputAt !== undefined && performance.now() - this.lastInputAt < GC_INPUT_SETTLE_MS) return 'input';
    if (this.vmRuntime && this.looperHost.nextDelay(this.clock.now()) === 0) return 'events-due';
    return null;
  }
  /**
   * Host ms until the Worker should pump once more for a deferred collection, or null: only while the deferral is held by nothing but the input window (no frame, no due event), whose end
   * would otherwise go unnoticed when the app has nothing scheduled -- the deferred collection would then land at the start of the next input. The pump's maybeCollect runs it at idle.
   */
  gcIdleWakeDelay() {
    if (!this.vmRuntime?.gcDeferral || this.mainThreadMotion() !== 'input') return null;
    return Math.max(1, Math.ceil(GC_INPUT_SETTLE_MS - (performance.now() - this.lastInputAt)) + 1);
  }
  // `untilFrame`: the pump ends once a Choreographer frame (or traversal) committed a new frame, so its caller can show it before the next one runs (the Worker's frame pacing,
  // src/apk-worker.js drainReadyEvents); the events still due stay queued, in their order, for the next pump.
  // `hostBudgetMs`: the host time after which the pump returns to its caller (DRAIN_HOST_BUDGET_MS; the Worker asks for less when it wants to yield sooner: src/apk-worker.js ioYieldMs).
  drainEvents(runtime, { now = this.clock.now(), maxEvents = 32, untilFrame = false, hostBudgetMs = DRAIN_HOST_BUDGET_MS } = {}) {
    if (!Number.isFinite(now) || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 256) error('Invalid bounded message queue drain');
    this.vmRuntime = runtime;
    if (runtime.debugger?.mainHeld) return runtime.debugger.drainHeld(runtime, hostBudgetMs);   // the debugger suspends the main thread: only the threads it lets run run (src/debugger.js)
    if (now > this.clock.now()) this.clock.skip(now - this.clock.now() + 1e-6);   // a caller that names a later time (tests, tools) says that time has arrived: the Java queue reads the VM clock
    const looper = this.looperHost; looper.ensureMain(runtime); looper.flushDeferred(runtime);
    let processed = 0, mainProcessed = 0;   // mainProcessed: the main thread's events among them (the rest are background slices)
    maybeCollect(runtime);   // quiescent point between host events: reclaim unreachable Java objects when the heap is filling (every call under APKWEB_GC_AUDIT=1)
    if (this.externalSources) for (const source of this.externalSources) source.drained?.();
    // UI first (ViewRootImpl.scheduleTraversals posts a sync barrier and an asynchronous frame callback, so the traversal and the frame run before the ordinary messages queued ahead of them): a due layout
    // pass or Choreographer frame goes before any other due event, whatever order the queue holds them in.
    // The priority only applies once the main thread is behind (the head event is overdue by more than UI_FIRST_BEHIND_MS of virtual time -- a flood, not the ordinary jitter of a launch): in the normal flow due-time order is kept, so a launch does not lay out twice.
    // The due time moves with the VM clock while the pump runs (as Looper.loopOnce reads uptimeMillis each time): a frame whose vsync arrives during this pump runs in its next round
    // instead of waiting for the next pump. A frozen or deterministic clock (frames, tests) does not move, so nothing changes there.
    // Served on the stack of a main thread that is parked in a wait (Scheduler.mainParked): the app's own main-thread work (Handler messages, frames, traversals, View.post)
    // waits for main to come back, as on a device; only the lab's host tasks run. Running a frame or a message there re-entered Compose in the middle of a composition that
    // waited: ComposeRuntimeError "pending composition has not been applied".
    const parked = (runtime.scheduler?.parkedServing ?? 0) > 0 && runtime.scheduler.mainParked();
    // The main thread's event suspended in its wait (vmcore/js/host-bridge.js suspendable): main is blocked in it, so only what may run while main is parked runs (as above),
    // and the event itself is resumed here, ahead of everything else, once its wait is over -- by this pump only, never by one nested on a wait.
    const suspended = () => runtime.wasm?.mainSuspended === true;
    const nextDue = () => {
      if (suspended()) return runtime.nestedRuns === 0 && runtime.wasm.suspendedReady() ? RESUME_SUSPENDED : looper.nextDueWhileParked(runtime, Math.max(now, this.clock.now()));
      return parked ? looper.nextDueWhileParked(runtime, Math.max(now, this.clock.now())) : looper.nextDue(runtime, Math.max(now, this.clock.now()), UI_FIRST_BEHIND_MS);
    };
    // Fair scheduling: every round runs the main Looper's due events first (bounded by host time once background work is waiting), then ONE bounded background slice of green threads (coroutine workers, executors:
    // 8 ms of host time, 2 ms until the first frame is committed), and repeats -- so a flood of background work makes steady progress without ever starving the main thread's traversal and frame.
    const firstFrameDone = (this.viewWindowHost?.frameState?.().framesRun ?? 1) > 0, MAIN_BUDGET_MS = 16;
    const inMotion = () => { const motion = this.mainThreadMotion(); return motion === 'frame-pending' || motion === 'frame-running' || motion === 'input'; };
    let backgroundMs = 0;
    const floor = this.backgroundFloor ??= new BackgroundFloor(), floorPending = () => runtime.multiThreaded && runtime.scheduler.hasRunnable();
    floor.observe(performance.now(), firstFrameDone && floorPending());
    // The background floor (src/background-floor.js): what background threads are owed runs between two main-thread events, before the next one, in slices of at most
    // BACKGROUND_FLOOR_SLICE_MAX_MS; only once the screen has frames (the launch has its own 2 ms slices).
    const payFloor = () => {
      if (!firstFrameDone || !runtime.multiThreaded) return;
      for (let n = 0; n < 4; n++) {
        floor.observe(performance.now(), floorPending()); const owed = floor.owed();
        if (owed < 1 || !floor.pending) return;
        const at = performance.now(); runtime.steps = 0; runtime.sliceDeadline = at + Math.min(owed, BACKGROUND_FLOOR_SLICE_MAX_MS);
        try { runtime.monitor.sliceRan(); runtime.runThreads(); } finally { runtime.sliceDeadline = 0; const ms = performance.now() - at; floor.record(ms); backgroundMs += ms; runtime.scheduler.charge(runtime.scheduler.lastPicked, ms); const window = this.interactionWindow(); if (window) { window.floorMs += ms; window.endedAt = performance.now(); this.noteThreadSlice(window, runtime.scheduler.lastPicked?.name, ms); } }
      }
    };
    const drainStart = performance.now(), framesRun = () => this.viewWindowHost?.frameState?.().framesRun ?? 0, framesBefore = untilFrame ? framesRun() : 0;
    let framed = false;
    // One main-thread event: the watchdog, the clock and the collector see it as they always did; the original Looper.loopOnce (or, for a UI event that jumps the queue, the Runnable itself) runs it.
    const runEvent = due => {
      const window = this.interactionWindow(), eventStart = window ? performance.now() : 0, tb = window ? runtime.tb : null, measured = tb ? tb.eventBegin() : null;
      // the longest event is named by what it ran (the Runnable or the message's what, read before it runs: a dispatched Message is recycled) and by where its time went
      const what = window ? this.describeDispatch(runtime, due.event) : null;
      try { return runEventCore(due); } finally {
        if (window) {
          const ms = performance.now() - eventStart; window.mainMs += ms; window.mainEvents++; window.endedAt = window.lastMainAt = performance.now();
          if (!window.longestMain || ms > window.longestMain.ms) window.longestMain = { ms, event: what ?? this.describeEvent(runtime, due.event), ...(measured ? tb.eventEnd(measured) : {}) };
          else if (measured) tb.eventDrop(measured);
        }
      }
    };
    const runEventCore = due => {
      const event = due.event, hostMark = runtime.hostAllocs.length;
      runtime.monitor.eventRan(event); runtime.monitor.mainEventBegin(this.describeEvent(runtime, event)); const frozen = event.windowFrameTime !== undefined ? this.clock.freeze() : false;   // a Choreographer frame callback runs at its vsync instant (see VMClock)
      try {
        runtime.steps = 0;
        runtime.hostRoots.push(event); const savedSafeDepth = runtime.gcSafeDepth; if (!event.platformTask || due === RESUME_SUSPENDED) runtime.gcSafeDepth = 1;   // a Handler message is only referenced from here: root it, and allow safepoint collections inside it
        try { if (due === RESUME_SUSPENDED) runtime.wasm.resumeSuspended(); else if (due.direct) looper.runDirect(runtime, event); else looper.loopOnce(runtime); }   // a resumed message ends in loopOnce's continuation
        catch (error) {
          // A message whose exception escaped dispatchMessage. At the top level the pump's caller reports it. When this pump runs inside a nested run (a host wait or a thread switch served
          // the queue while some thread is parked in a Java frame below on the JavaScript stack), letting it propagate would deliver it to THAT frame: a synchronized block's catch-all
          // there caught an exception that was not its own, its monitor-exit found the monitor released by Object.wait, and the handler looped on IllegalMonitorStateException until the
          // object limit (seen in a real app at HandlerThread.getLooper). As on Android the exception belongs to the message's thread: Thread.dispatchUncaughtException runs on main
          // (the default handler: fatal in strict mode, recorded in tolerant mode) and the parked frame never sees it.
          if (runtime.nestedRuns > 0 && error !== null && typeof error === 'object' && error.value !== undefined && error.value !== null && typeof error.value.ref === 'number' && runtime.uncaughtHook) {
            const main = runtime.scheduler.mainThread();
            if (!main.javaObject) { runtime.mainThread ??= runtime.makeObject('Ljava/lang/Thread;'); main.javaObject = runtime.mainThread; runtime.object(runtime.mainThread).thread = main; }
            runtime.record(`RUNTIME uncaught exception of a main-Looper message run while a thread waits in a nested host call: ${runtime.typeOf(error.value)}`);
            runtime.finishHostStep(runtime.uncaughtHook(main, error));
          } else throw error;
        }
        finally { runtime.gcSafeDepth = savedSafeDepth; runtime.hostRoots.pop(); }
      } finally { runtime.monitor.mainEventEnd(); if (frozen) this.clock.thaw(); if (runtime.hostAllocs.length > hostMark) runtime.releaseHostAllocs(hostMark); }   // what the event's host code allocated is not in flight any more (natives further out stay below the mark)
    };
    for (let round = 0, slices = 0; round < 64 && (round === 0 || performance.now() - drainStart < hostBudgetMs); round++) {   // one pump returns to its caller within ~DRAIN_HOST_BUDGET_MS of host time (the page, input and the next pump get their turn)
      let ran = 0; const roundStart = performance.now();
      for (let due; processed < maxEvents && (payFloor(), due = nextDue());) {   // the floor runs before the next event is chosen (what it posts is then in the queue, as on a device)
        if (runtime.monitor.active) runtime.monitor.tick();
        runtime.stressCollect();   // APKWEB_GC_STRESS: whatever the next task needs must be reachable now
        ran++; runEvent(due); processed++; mainProcessed++;
        if (untilFrame && framesRun() > framesBefore) { framed = true; break; }
        if (performance.now() - roundStart > MAIN_BUDGET_MS && runtime.multiThreaded && runtime.scheduler.hasRunnable()) break;   // background work gets its turn between main-thread events
      }
      if (framed) break;   // a committed frame goes to the page before any background slice: a slice here (one that could not be preempted ran 20-70 ms) would hold the frame back
      const moving = firstFrameDone && inMotion(), sliceMs = !firstFrameDone ? 2 : moving ? MOTION_SLICE_MS : 8;
      if (moving && backgroundMs >= MOTION_BACKGROUND_BUDGET_MS) { if (!ran || framed) break; continue; }   // the screen moves: background had its share of this pump; the main thread's next event or frame comes first
      if (runtime.multiThreaded && slices < 64 && runtime.scheduler.hasRunnable()) { const sliceStart = performance.now(), sliceLog = runtime.sliceLog, mark = sliceLog ? sliceLog.sliceBegin(runtime) : null; runtime.steps = 0; runtime.sliceDeadline = performance.now() + sliceMs; try { runtime.monitor.sliceRan(); runtime.runThreads(); } finally { runtime.sliceDeadline = 0; backgroundMs += performance.now() - sliceStart; runtime.scheduler.charge(runtime.scheduler.lastPicked, performance.now() - sliceStart); if (mark) sliceLog.sliceEnd(runtime, mark, runtime.scheduler.lastPicked?.name, false); floor.record(performance.now() - sliceStart);
          const window = this.interactionWindow(); if (window) { const ms = performance.now() - sliceStart; window.sliceMs += ms; window.slices++; window.endedAt = performance.now(); this.noteThreadSlice(window, runtime.scheduler.lastPicked?.name, ms); if (ms - sliceMs > PARALLEL_CREDIT_MIN_MS) window.overruns++; if (!window.longestSlice || ms > window.longestSlice.ms) window.longestSlice = { ms, thread: runtime.scheduler.lastPicked?.name ?? null, hostCall: runtime.lastHostCall ?? null }; } } processed++; slices++; ran++;
        // A slice that could not be preempted (one thread inside a long native call) kept the processor far beyond its share while the other runnable threads waited. On a device they would
        // have run in parallel during that time, so they get that time now (bounded), before the main thread's next event, even while the screen moves (the frame was already late by the whole overrun): work an app starts on a second thread and expects done "long before"
        // a slow first thread finishes (an initialization queue next to a script-loading thread) otherwise loses to the first frame.
        const overrun = performance.now() - sliceStart - sliceMs;
        if (overrun > PARALLEL_CREDIT_MIN_MS && runtime.scheduler.hasRunnable()) { const creditMark = sliceLog ? sliceLog.sliceBegin(runtime) : null, creditStart = performance.now(); runtime.steps = 0; runtime.sliceDeadline = performance.now() + Math.min(overrun, PARALLEL_CREDIT_MAX_MS); try { runtime.monitor.sliceRan(); runtime.runThreads(); } finally { runtime.sliceDeadline = 0; if (creditMark) sliceLog.sliceEnd(runtime, creditMark, runtime.scheduler.lastPicked?.name, true); floor.record(performance.now() - creditStart); runtime.scheduler.charge(runtime.scheduler.lastPicked, performance.now() - creditStart); const window = this.interactionWindow(); if (window) { window.creditMs += performance.now() - creditStart; window.endedAt = performance.now(); this.noteThreadSlice(window, runtime.scheduler.lastPicked?.name, performance.now() - creditStart); } } slices++; }
      }
      if (!ran || framed) break;
    }
    // MessageQueue.next(): the thread that finished a message goes back to next(), which runs the IdleHandlers when nothing is due and then blocks (the call ends with a LooperYield).
    if (!parked && !suspended() && looper.armed && !this.runningIdle && !nextDue()) {   // IdleHandlers are the app's main-thread work too: not while main is parked
      this.runningIdle = true; const mark = runtime.hostAllocs.length; runtime.monitor.mainEventBegin('MessageQueue.next (IdleHandlers)');
      try { runtime.steps = 0; looper.loopOnce(runtime); } finally { runtime.monitor.mainEventEnd(); this.runningIdle = false; if (runtime.hostAllocs.length > mark) runtime.releaseHostAllocs(mark); }
    }
    // The Activity brought to the front is idle: the ones that finished before it stop and are destroyed now (ActivityTaskSupervisor.activityIdleInternal), as a main-thread message.
    if (!parked && !suspended() && this.stoppingFrames?.length && !this.stopsQueued && !nextDue()) { this.stopsQueued = true; const frames = [...this.stoppingFrames]; this.queueTask(() => { this.stopsQueued = false; for (const frame of frames) this.stopFinished(runtime, frame); }, 0, frames.map(frame => frame.activity)); processed++; mainProcessed++; }   // counted: the caller pumps again for it
    // The main thread's idle moment (nothing due, so next() is about to block): a collection the pacing deferred while the screen was in motion runs here, once no frame is pending either
    // (maybeCollect asks mainThreadMotion again: an IdleHandler may have posted work).
    if (runtime.gcDeferral && !nextDue()) maybeCollect(runtime);
    const eventDelay = this.nextEventDelay(), threadDelay = runtime.scheduler.threadDelay();
    let waitingIO = 0; if (this.externalSources) for (const source of this.externalSources) waitingIO += source.pending?.() ?? 0;
    return { processed, mainProcessed, pending: looper.count(runtime), waitingIO, eventDelay, nextDelay: eventDelay === null ? threadDelay : threadDelay === null ? eventDelay : Math.min(eventDelay, threadDelay) };   // eventDelay: the main thread's own next event (null: none queued)
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
      if ((source.bundleVersion || 0) !== object.expectedVersion) runtime.throwJava('Ljava/util/ConcurrentModificationException;', null);
      if (name === 'hasNext') return object.index < object.keys.length ? 1 : 0;
      if (name === 'next') { if (object.index >= object.keys.length) runtime.throwJava('Ljava/util/NoSuchElementException;', null); object.last = object.keys[object.index++]; return object.last; }
      if (name === 'remove') { if (object.last === null) runtime.throwJava('Ljava/lang/IllegalStateException;', null); entries.delete(object.last); source.bundleVersion = (source.bundleVersion || 0) + 1; object.expectedVersion = source.bundleVersion; object.last = null; return; }
    }
    error(`Unsupported Bundle key view ${name}`);
  }
  intentInvoke(runtime, method, args) {
    const value = args[0], intent = runtime.object(value), name = method.name;
    if (name === '<init>') {
      intent.extras = new Map(); intent.flags = 0; intent.action = null; intent.target = null; intent.data = null; intent.mimeType = null;
      if (method.parameters[0] === INTENT) { const source = runtime.object(args[1]); Object.assign(intent, { extras: new Map(source.extras || []), extrasPresent: !!source.extrasPresent || !!source.extras?.size, extrasClassLoader: source.extrasClassLoader ?? null, flags: source.flags || 0, action: source.action, target: source.target, data: source.data ?? null, mimeType: source.mimeType ?? null, component: source.component ?? null, identifier: source.identifier ?? null, package: source.package ?? null, categories: source.categories ? [...source.categories] : undefined, clipData: source.clipData ?? null }); }
      else if (method.parameters[1] === 'Landroid/net/Uri;') { intent.action = checkString(args[1], 'Intent action'); if (args[2] && !runtime.isSubtype(runtime.object(args[2]).type, 'Landroid/net/Uri;')) error('Intent data must be a Uri'); intent.data = args[2]; }
      else if (method.parameters.length === 2) { intent.target = runtime.object(args[2]).classType; if (this.packages.multi) { const owner = this.packages.contextEntry(runtime, args[1]); if (!owner.main) intent.componentPackage = owner.name; } }   // Intent(Context, Class): the component is in the Context's package
      else if (method.parameters[0] === 'Ljava/lang/String;') intent.action = checkString(args[1], 'Intent action');
      return;
    }
    if (name === 'setExtrasClassLoader') { if (intent.extrasPresent || intent.extras?.size) intent.extrasClassLoader = args[1]; return; }
    if (name === 'getData') return intent.data ?? null;
    if (name === 'getDataString') return intent.data ? runtime.dispatch({ owner: 'Landroid/net/Uri;', name: 'toString', signature: '()Ljava/lang/String;', parameters: [], result: 'Ljava/lang/String;' }, [intent.data], 'virtual') : null;
    if (name === 'getType') return intent.mimeType ?? null;
    if (name === 'setType') { intent.mimeType = args[1]; intent.data = null; return value; }
    if (name === 'setData' || name === 'setDataAndType') { if (args[1] && !runtime.isSubtype(runtime.object(args[1]).type, 'Landroid/net/Uri;')) error('Intent data must be a Uri'); intent.data = args[1] || null; intent.mimeType = name === 'setDataAndType' ? args[2] : null; return value; }
    if (name === 'setClass') { intent.target = runtime.object(args[2]).classType; intent.component = null; intent.componentPackage = null; if (this.packages.multi) { const owner = this.packages.contextEntry(runtime, args[1]); if (!owner.main) intent.componentPackage = owner.name; } return value; }
    if (name === 'setClassName') { const className = checkString(args[2], 'Intent class name'); const packageName = typeof args[1] === 'string' ? args[1] : this.resources?.table?.packages?.[0]?.name || runtime.activityType.slice(1, -1).split('/').slice(0, -1).join('.'); intent.target = descriptor(className.startsWith('.') ? packageName + className : className.includes('.') ? className : `${packageName}.${className}`); intent.component = null; intent.componentPackage = typeof args[1] === 'string' ? packageName : null; return value; }
    if (name === 'setComponent') { intent.component = args[1] ?? null; if (args[1]) { const className = runtime.object(args[1]).className; if (typeof className === 'string' && runtime.classes.has(descriptor(className))) intent.target = descriptor(className); } return value; }
    if (name === 'getComponent') {
      // Intent(Context, Class) / setClass / setClassName set mComponent = new ComponentName(package, class) on Android.
      if (!intent.component && intent.target) {
        const component = runtime.allocate('Landroid/content/ComponentName;');
        runtime.dispatch({ owner: 'Landroid/content/ComponentName;', name: '<init>', parameters: ['Ljava/lang/String;', 'Ljava/lang/String;'], result: 'V', signature: '(Ljava/lang/String;Ljava/lang/String;)V' }, [component, intent.componentPackage ?? this.packageName, dottedName(intent.target)], 'direct');
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
