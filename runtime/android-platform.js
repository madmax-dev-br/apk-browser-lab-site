import { createComposeCanvasHost } from './compose-canvas-host.js?v=12647cd43215';
import { createViewTransformHost } from './view-transform-host.js?v=12647cd43215';
import { createViewPropertyAnimatorHost } from './view-property-animator-host.js?v=12647cd43215';
import { createViewOutlineHost } from './view-outline-host.js?v=12647cd43215';
import { createShaderHost } from './shader-host.js?v=12647cd43215';
import { createSystemBarsHost } from './system-bars-host.js?v=12647cd43215';
import { createDeviceStateHost } from './device-state-host.js?v=12647cd43215';
import { createJobSchedulerHost } from './job-scheduler-host.js?v=12647cd43215';
import { createPendingIntentHost } from './pending-intent-host.js?v=12647cd43215';
import { createBinderHost } from './binder-host.js?v=12647cd43215';
import { createInputManagerHost } from './input-native.js?v=12647cd43215';
import { resolveDevice } from './device-profile.js?v=12647cd43215';
import { configurationFor } from './device-configuration.js?v=12647cd43215';
import { createViewCoordinateHost } from './view-coordinate-host.js?v=12647cd43215';
import { createEditableTextHost } from './editable-text-host.js?v=12647cd43215';
import { createComponentCallbacksHost } from './component-callbacks-host.js?v=12647cd43215';
import { createViewStateHost } from './view-state-host.js?v=12647cd43215';
import { createLocaleServiceHost } from './locale-service-host.js?v=12647cd43215';
import { APKError } from './apk-runtime.js?v=12647cd43215';
import { AndroidXmlHost, XML_METHODS } from './android-xml-host.js?v=12647cd43215';
import { createViewTreeHost } from './view-tree-host.js?v=12647cd43215';
import { createDialogWindowHost } from './dialog-window-host.js?v=12647cd43215';
import { createViewWindowHost } from './view-window-host.js?v=12647cd43215';
import { createVectorCanvasHost } from './vector-native.js?v=12647cd43215';
import { createPaintHost } from './paint-host.js?v=12647cd43215';
import { createContentResolverHost } from './content-resolver-host.js?v=12647cd43215';
import { createDrawableViewHost } from './drawable-view-host.js?v=12647cd43215';
import { createDeviceServicesHost } from './device-services-host.js?v=12647cd43215';
import { createSystemServicesHost } from './system-services-host.js?v=12647cd43215';
import { createJavaIoHost } from './java-io-host.js?v=12647cd43215';
import { createClassLoaderHost } from './class-loader-host.js?v=12647cd43215';
import { createAppServicesHost } from './app-services-host.js?v=12647cd43215';
import { createConcurrencyHost } from './concurrency-host.js?v=12647cd43215';
import { createDateTimeHost } from './datetime-host.js?v=12647cd43215';
import { createFormatterHost } from './formatter-host.js?v=12647cd43215';
import { createCryptoHost } from './crypto-host.js?v=12647cd43215';
import { createDatabaseSupportHost } from './database-support-host.js?v=12647cd43215';
import { VMClock } from './vm-clock.js?v=12647cd43215';
import { createWindowInsetsHost } from './window-insets-host.js?v=12647cd43215';
import { createAccessibilityServiceHost } from './accessibility-service-host.js?v=12647cd43215';
import { createViewLayoutHost } from './view-layout-host.js?v=12647cd43215';
import { createInputMethodServiceHost } from './input-method-service-host.js?v=12647cd43215';
import { createAutofillServiceHost } from './autofill-service-host.js?v=12647cd43215';
import { createClipboardServiceHost } from './clipboard-service-host.js?v=12647cd43215';
import { createViewInputHost } from './view-input-host.js?v=12647cd43215';
import { AndroidStyleBackend, STYLE_METHODS } from './android-style-backend.js?v=12647cd43215';
import { maybeCollect } from './heap-gc.js?v=12647cd43215';

const ACTIVITY = 'Landroid/app/Activity;', INTENT = 'Landroid/content/Intent;', BUNDLE = 'Landroid/os/Bundle;';
const APPLICATION = 'Landroid/app/Application;', APP_CONTEXT = 'Landroid/app/ContextImpl;';
const CONTEXTS = [ACTIVITY, APPLICATION, APP_CONTEXT, 'Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;'];
const KEYS = new Set();
KEYS.add('Landroid/os/StrictMode;->assertConfigurationContext(Landroid/content/Context;Ljava/lang/String;)V');
const FRAGMENT = 'Landroid/app/Fragment;', FRAGMENT_MANAGER = 'Landroid/app/FragmentManager;', TRANSACTION = 'Landroid/app/FragmentTransaction;';
const LOCALE = 'Ljava/util/Locale;', LOCALES = 'Landroid/os/LocaleList;';
const PACKAGE_MANAGER = 'Landroid/content/pm/PackageManager;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;', ACTIVITY_INFO = 'Landroid/content/pm/ActivityInfo;', COMPONENT = 'Landroid/content/ComponentName;';
const CONFIGURATION = 'Landroid/content/res/Configuration;', METRICS = 'Landroid/util/DisplayMetrics;';
const INFLATER = 'Landroid/view/LayoutInflater;', ATTRIBUTES = 'Lapkweb/bridge/AttributeSet;';
const WINDOW = 'Landroid/view/Window;', PORTER_MODE = 'Landroid/graphics/PorterDuff$Mode;';
const LAYOUT_PARAMS = 'Landroid/view/ViewGroup$LayoutParams;', MARGIN_PARAMS = 'Landroid/view/ViewGroup$MarginLayoutParams;';
const EDITABLE = 'Lapkweb/bridge/Editable;';
const PROCESS_INFO = 'Landroid/app/ActivityManager$RunningAppProcessInfo;';
const HANDLER = 'Landroid/os/Handler;', MESSAGE = 'Landroid/os/Message;';
const KEY_SET = 'Lapkweb/bridge/BundleKeySet;', KEY_ITERATOR = 'Lapkweb/bridge/BundleKeyIterator;';
function add(owner, signatures) { for (const signature of signatures) KEYS.add(`${owner}->${signature}`); }
for (const owner of CONTEXTS) add(owner, ['createConfigurationContext(Landroid/content/res/Configuration;)Landroid/content/Context;', 'isRestricted()Z', 'getClassLoader()Ljava/lang/ClassLoader;', 'getSystemService(Ljava/lang/String;)Ljava/lang/Object;', 'getSystemService(Ljava/lang/Class;)Ljava/lang/Object;', 'getPackageManager()Landroid/content/pm/PackageManager;', 'getApplicationInfo()Landroid/content/pm/ApplicationInfo;', 'getApplicationContext()Landroid/content/Context;', 'getPackageName()Ljava/lang/String;', 'getResources()Landroid/content/res/Resources;', 'getString(I)Ljava/lang/String;', 'getText(I)Ljava/lang/CharSequence;', 'startActivity(Landroid/content/Intent;)V']);
add('Landroid/app/ActivityThread;', ['currentApplication()Landroid/app/Application;']);
add(ACTIVITY, ['onConfigurationChanged(Landroid/content/res/Configuration;)V']);
add(ACTIVITY, ['setResult(I)V', 'setResult(ILandroid/content/Intent;)V', 'startActivityForResult(Landroid/content/Intent;I)V', 'startActivityForResult(Landroid/content/Intent;ILandroid/os/Bundle;)V', 'onActivityResult(IILandroid/content/Intent;)V', 'onCreateView(Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', 'onCreateView(Landroid/view/View;Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', 'getTitle()Ljava/lang/CharSequence;', 'setTitle(Ljava/lang/CharSequence;)V', 'setTitle(I)V', 'getWindow()Landroid/view/Window;', 'getFragmentManager()Landroid/app/FragmentManager;', 'getLastNonConfigurationInstance()Ljava/lang/Object;', 'onRetainNonConfigurationInstance()Ljava/lang/Object;', 'isChangingConfigurations()Z', 'isDestroyed()Z', 'recreate()V', 'onPostResume()V', 'onRestart()V', 'onStart()V', 'onResume()V', 'onPause()V', 'onStop()V', 'onDestroy()V', 'onSaveInstanceState(Landroid/os/Bundle;)V', 'onRestoreInstanceState(Landroid/os/Bundle;)V', 'onPostCreate(Landroid/os/Bundle;)V']);
add(FRAGMENT, ['<init>()V', 'getActivity()Landroid/app/Activity;', 'getContext()Landroid/content/Context;', 'getFragmentManager()Landroid/app/FragmentManager;', 'setArguments(Landroid/os/Bundle;)V', 'getArguments()Landroid/os/Bundle;', 'setRetainInstance(Z)V', 'getRetainInstance()Z', 'isAdded()Z', 'getView()Landroid/view/View;', 'onCreateView(Landroid/view/LayoutInflater;Landroid/view/ViewGroup;Landroid/os/Bundle;)Landroid/view/View;', 'onViewCreated(Landroid/view/View;Landroid/os/Bundle;)V', 'onDestroyView()V', 'onAttach(Landroid/content/Context;)V', 'onAttach(Landroid/app/Activity;)V', 'onCreate(Landroid/os/Bundle;)V', 'onActivityCreated(Landroid/os/Bundle;)V', 'onStart()V', 'onResume()V', 'onPause()V', 'onStop()V', 'onDestroy()V', 'onDetach()V']);
add(FRAGMENT_MANAGER, ['findFragmentByTag(Ljava/lang/String;)Landroid/app/Fragment;', 'beginTransaction()Landroid/app/FragmentTransaction;', 'executePendingTransactions()Z', 'isDestroyed()Z']);
add(TRANSACTION, ['add(ILandroid/app/Fragment;Ljava/lang/String;)Landroid/app/FragmentTransaction;', 'add(Landroid/app/Fragment;Ljava/lang/String;)Landroid/app/FragmentTransaction;', 'remove(Landroid/app/Fragment;)Landroid/app/FragmentTransaction;', 'commit()I', 'commitAllowingStateLoss()I', 'commitNow()V', 'commitNowAllowingStateLoss()V']);
add(APPLICATION, ['<init>()V', 'onCreate()V', 'registerActivityLifecycleCallbacks(Landroid/app/Application$ActivityLifecycleCallbacks;)V', 'unregisterActivityLifecycleCallbacks(Landroid/app/Application$ActivityLifecycleCallbacks;)V']);
add('Landroid/content/ContextWrapper;', ['<init>(Landroid/content/Context;)V', 'attachBaseContext(Landroid/content/Context;)V', 'getBaseContext()Landroid/content/Context;']);
add(ACTIVITY, ['getApplication()Landroid/app/Application;', '<init>()V', 'onCreate(Landroid/os/Bundle;)V', 'setContentView(I)V', 'setContentView(Landroid/view/View;)V', 'setContentView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V', 'findViewById(I)Landroid/view/View;', 'getIntent()Landroid/content/Intent;', 'setIntent(Landroid/content/Intent;)V', 'finish()V', 'isFinishing()Z', 'onBackPressed()V']);
add('Landroid/view/View;', ['saveAttributeDataForStyleable(Landroid/content/Context;[ILandroid/util/AttributeSet;Landroid/content/res/TypedArray;II)V', 'isForegroundInsidePadding()Z', 'getForegroundGravity()I', 'setForegroundGravity(I)V', 'setSaveFromParentEnabled(Z)V', 'isSaveFromParentEnabled()Z', 'setSaveEnabled(Z)V', 'isSaveEnabled()Z', 'hasOnClickListeners()Z', 'setImportantForAutofill(I)V', 'getImportantForAutofill()I', 'isLaidOut()Z', 'getId()I', 'setId(I)V', 'findViewById(I)Landroid/view/View;', 'getContext()Landroid/content/Context;', 'setEnabled(Z)V', 'isEnabled()Z', 'setPadding(IIII)V', 'getPaddingLeft()I', 'getPaddingTop()I', 'getPaddingRight()I', 'getPaddingBottom()I']);
for (const owner of ['Landroid/widget/LinearLayout;', 'Landroid/widget/TextView;', 'Landroid/widget/Button;']) add(owner, ['<init>(Landroid/content/Context;)V']);
add('Landroid/widget/TextView;', ['getFilters()[Landroid/text/InputFilter;', 'setFilters([Landroid/text/InputFilter;)V']);
add('Landroid/widget/TextView;', ['getTypeface()Landroid/graphics/Typeface;', 'setTypeface(Landroid/graphics/Typeface;)V', 'setTypeface(Landroid/graphics/Typeface;I)V', 'getTransformationMethod()Landroid/text/method/TransformationMethod;', 'setTransformationMethod(Landroid/text/method/TransformationMethod;)V', 'setText(I)V', 'getText()Ljava/lang/CharSequence;', 'setTextColor(I)V', 'setTextSize(IF)V']);
add('Landroid/content/res/Resources;', ['getString(I)Ljava/lang/String;', 'getText(I)Ljava/lang/CharSequence;', 'getInteger(I)I', 'getBoolean(I)Z', 'getColor(I)I', 'getDimension(I)F', 'getDimensionPixelSize(I)I', 'getDimensionPixelOffset(I)I', 'getResourcePackageName(I)Ljava/lang/String;', 'getIdentifier(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)I', 'getResourceName(I)Ljava/lang/String;', 'getResourceEntryName(I)Ljava/lang/String;', 'getResourceTypeName(I)Ljava/lang/String;']);
add(INTENT, ['setExtrasClassLoader(Ljava/lang/ClassLoader;)V', 'setComponent(Landroid/content/ComponentName;)Landroid/content/Intent;', 'getComponent()Landroid/content/ComponentName;', 'setPackage(Ljava/lang/String;)Landroid/content/Intent;', 'getPackage()Ljava/lang/String;', 'addCategory(Ljava/lang/String;)Landroid/content/Intent;', 'hasCategory(Ljava/lang/String;)Z', 'removeCategory(Ljava/lang/String;)V', 'getScheme()Ljava/lang/String;']);
add(INTENT, ['getData()Landroid/net/Uri;', 'getDataString()Ljava/lang/String;', 'setData(Landroid/net/Uri;)Landroid/content/Intent;', 'setDataAndType(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;', 'getType()Ljava/lang/String;', 'setType(Ljava/lang/String;)Landroid/content/Intent;', '<init>(Ljava/lang/String;Landroid/net/Uri;)V', '<init>()V', '<init>(Landroid/content/Context;Ljava/lang/Class;)V', '<init>(Ljava/lang/String;)V', '<init>(Landroid/content/Intent;)V', 'setClass(Landroid/content/Context;Ljava/lang/Class;)Landroid/content/Intent;', 'setClassName(Landroid/content/Context;Ljava/lang/String;)Landroid/content/Intent;', 'setClassName(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;', 'getAction()Ljava/lang/String;', 'setAction(Ljava/lang/String;)Landroid/content/Intent;', 'getFlags()I', 'setFlags(I)Landroid/content/Intent;', 'addFlags(I)Landroid/content/Intent;', 'hasExtra(Ljava/lang/String;)Z', 'removeExtra(Ljava/lang/String;)V', 'getExtras()Landroid/os/Bundle;', 'putExtras(Landroid/os/Bundle;)Landroid/content/Intent;', 'replaceExtras(Landroid/os/Bundle;)Landroid/content/Intent;']);
add(PROCESS_INFO, ['<init>()V', '<init>(Ljava/lang/String;I[Ljava/lang/String;)V']);
add('Landroid/app/ActivityManager;', ['getMyMemoryState(Landroid/app/ActivityManager$RunningAppProcessInfo;)V']);
add(HANDLER, ['<init>()V', '<init>(Landroid/os/Looper;)V', '<init>(Landroid/os/Handler$Callback;)V', '<init>(Landroid/os/Looper;Landroid/os/Handler$Callback;)V', '<init>(Landroid/os/Looper;Landroid/os/Handler$Callback;Z)V', '<init>(Landroid/os/Handler$Callback;Z)V', 'getLooper()Landroid/os/Looper;', 'createAsync(Landroid/os/Looper;)Landroid/os/Handler;', 'createAsync(Landroid/os/Looper;Landroid/os/Handler$Callback;)Landroid/os/Handler;', 'dispatchMessage(Landroid/os/Message;)V', 'handleMessage(Landroid/os/Message;)V', 'obtainMessage()Landroid/os/Message;', 'obtainMessage(I)Landroid/os/Message;', 'obtainMessage(IIILjava/lang/Object;)Landroid/os/Message;', 'obtainMessage(III)Landroid/os/Message;', 'obtainMessage(ILjava/lang/Object;)Landroid/os/Message;', 'sendMessage(Landroid/os/Message;)Z', 'sendMessageDelayed(Landroid/os/Message;J)Z', 'sendMessageAtTime(Landroid/os/Message;J)Z', 'sendMessageAtFrontOfQueue(Landroid/os/Message;)Z', 'sendEmptyMessage(I)Z', 'sendEmptyMessageDelayed(IJ)Z', 'sendEmptyMessageAtTime(IJ)Z', 'post(Ljava/lang/Runnable;)Z', 'postDelayed(Ljava/lang/Runnable;J)Z', 'postDelayed(Ljava/lang/Runnable;Ljava/lang/Object;J)Z', 'postAtTime(Ljava/lang/Runnable;J)Z', 'postAtTime(Ljava/lang/Runnable;Ljava/lang/Object;J)Z', 'postAtFrontOfQueue(Ljava/lang/Runnable;)Z', 'removeCallbacks(Ljava/lang/Runnable;)V', 'removeCallbacks(Ljava/lang/Runnable;Ljava/lang/Object;)V', 'removeMessages(I)V', 'removeMessages(ILjava/lang/Object;)V', 'removeCallbacksAndMessages(Ljava/lang/Object;)V', 'hasMessages(I)Z', 'hasMessages(ILjava/lang/Object;)Z', 'hasCallbacks(Ljava/lang/Runnable;)Z']);
add(MESSAGE, ['<init>()V', 'obtain()Landroid/os/Message;', 'obtain(Landroid/os/Message;)Landroid/os/Message;', 'obtain(Landroid/os/Handler;)Landroid/os/Message;', 'obtain(Landroid/os/Handler;Ljava/lang/Runnable;)Landroid/os/Message;', 'obtain(Landroid/os/Handler;I)Landroid/os/Message;', 'obtain(Landroid/os/Handler;ILjava/lang/Object;)Landroid/os/Message;', 'obtain(Landroid/os/Handler;III)Landroid/os/Message;', 'obtain(Landroid/os/Handler;IIILjava/lang/Object;)Landroid/os/Message;', 'setTarget(Landroid/os/Handler;)V', 'getTarget()Landroid/os/Handler;', 'getCallback()Ljava/lang/Runnable;', 'sendToTarget()V', 'getWhen()J', 'getData()Landroid/os/Bundle;', 'peekData()Landroid/os/Bundle;', 'setData(Landroid/os/Bundle;)V', 'copyFrom(Landroid/os/Message;)V', 'recycle()V', 'setAsynchronous(Z)V', 'isAsynchronous()Z']);
add(ACTIVITY, ['getComponentName()Landroid/content/ComponentName;', 'getLayoutInflater()Landroid/view/LayoutInflater;']);
for (const owner of ['Landroid/view/View;', 'Landroid/view/ViewGroup;', ...['LinearLayout', 'FrameLayout', 'ScrollView', 'TextView', 'Button', 'EditText', 'CheckBox', 'Switch', 'ProgressBar'].map(name => `Landroid/widget/${name};`)]) add(owner, ['<init>(Landroid/content/Context;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;I)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;II)V']);
add('Landroid/content/res/Resources;', ['getConfiguration()Landroid/content/res/Configuration;', 'getDisplayMetrics()Landroid/util/DisplayMetrics;']);
add(PACKAGE_MANAGER, ['getServiceInfo(Landroid/content/ComponentName;I)Landroid/content/pm/ServiceInfo;', 'getActivityInfo(Landroid/content/ComponentName;I)Landroid/content/pm/ActivityInfo;', 'getApplicationInfo(Ljava/lang/String;I)Landroid/content/pm/ApplicationInfo;', 'hasSystemFeature(Ljava/lang/String;)Z']);
add(COMPONENT, ['<init>(Landroid/content/Context;Ljava/lang/Class;)V', '<init>(Landroid/content/Context;Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;)V', 'getClassName()Ljava/lang/String;', 'getPackageName()Ljava/lang/String;', 'flattenToString()Ljava/lang/String;', 'flattenToShortString()Ljava/lang/String;']);
add('Landroid/view/ViewGroup;', ['onViewAdded(Landroid/view/View;)V', 'onViewRemoved(Landroid/view/View;)V', 'generateDefaultLayoutParams()Landroid/view/ViewGroup$LayoutParams;', 'generateLayoutParams(Landroid/util/AttributeSet;)Landroid/view/ViewGroup$LayoutParams;']);
add('Landroid/view/View;', ['onFinishInflate()V']);
add('Landroid/view/ViewGroup;', ['setClipChildren(Z)V', 'getClipChildren()Z', 'setClipToPadding(Z)V', 'getClipToPadding()Z']);
add('Landroid/view/View;', ['setWillNotDraw(Z)V', 'willNotDraw()Z', 'getParent()Landroid/view/ViewParent;', 'setImportantForAccessibility(I)V', 'getImportantForAccessibility()I', 'isInEditMode()Z', 'addOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V', 'removeOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V', 'isAttachedToWindow()Z', 'onAttachedToWindow()V', 'onDetachedFromWindow()V']);
add(CONFIGURATION, ['getLayoutDirection()I', 'getLocales()Landroid/os/LocaleList;', 'setLocales(Landroid/os/LocaleList;)V', 'setLocale(Ljava/util/Locale;)V']);
add(LOCALE, ['clone()Ljava/lang/Object;', 'getScript()Ljava/lang/String;', '<init>(Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;)V', '<init>(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V', 'getDefault()Ljava/util/Locale;', 'forLanguageTag(Ljava/lang/String;)Ljava/util/Locale;', 'getLanguage()Ljava/lang/String;', 'getCountry()Ljava/lang/String;', 'getVariant()Ljava/lang/String;', 'toLanguageTag()Ljava/lang/String;', 'toString()Ljava/lang/String;', 'equals(Ljava/lang/Object;)Z']);
add(LOCALES, ['<init>([Ljava/util/Locale;)V', 'get(I)Ljava/util/Locale;', 'size()I', 'isEmpty()Z', 'indexOf(Ljava/util/Locale;)I', 'toLanguageTags()Ljava/lang/String;', 'getDefault()Landroid/os/LocaleList;', 'getAdjustedDefault()Landroid/os/LocaleList;', 'getEmptyLocaleList()Landroid/os/LocaleList;', 'forLanguageTags(Ljava/lang/String;)Landroid/os/LocaleList;']);
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
const VALUE_TYPES = new Map([['String', 'Ljava/lang/String;'], ['CharSequence', 'Ljava/lang/CharSequence;'], ['Int', 'I'], ['Long', 'J'], ['Boolean', 'Z'], ['Float', 'F'], ['Double', 'D'], ['Bundle', BUNDLE], ['Parcelable', 'Landroid/os/Parcelable;'], ['Serializable', 'Ljava/io/Serializable;'], ['StringArray', '[Ljava/lang/String;'], ['IntArray', '[I'], ['ByteArray', '[B'], ['StringArrayList', 'Ljava/util/ArrayList;'], ['IntegerArrayList', 'Ljava/util/ArrayList;'], ['ParcelableArrayList', 'Ljava/util/ArrayList;'], ['ParcelableArray', '[Landroid/os/Parcelable;'], ['SparseParcelableArray', 'Landroid/util/SparseArray;'], ['LongArray', '[J'], ['FloatArray', '[F'], ['DoubleArray', '[D'], ['BooleanArray', '[Z'], ['CharArray', '[C'], ['ShortArray', '[S'], ['Byte', 'B'], ['Char', 'C'], ['Short', 'S'], ['Binder', 'Landroid/os/IBinder;'], ['CharSequenceArray', '[Ljava/lang/CharSequence;'], ['CharSequenceArrayList', 'Ljava/util/ArrayList;'], ['Size', 'Landroid/util/Size;'], ['SizeF', 'Landroid/util/SizeF;']]);
for (const owner of [BUNDLE, 'Landroid/os/BaseBundle;', 'Landroid/os/PersistableBundle;']) {
  add(owner, ['<init>()V', '<init>(I)V', `<init>(${BUNDLE})V`, 'size()I', 'isEmpty()Z', 'containsKey(Ljava/lang/String;)Z', 'remove(Ljava/lang/String;)V', 'clear()V', `putAll(${BUNDLE})V`, 'keySet()Ljava/util/Set;', 'get(Ljava/lang/String;)Ljava/lang/Object;', 'clone()Ljava/lang/Object;', 'deepCopy()Landroid/os/Bundle;', 'setClassLoader(Ljava/lang/ClassLoader;)V', 'getClassLoader()Ljava/lang/ClassLoader;']);
  for (const [name, type] of VALUE_TYPES) {
    add(owner, [`put${name}(Ljava/lang/String;${type})V`, `get${name}(Ljava/lang/String;)${type}`]);
    if (['String', 'Int', 'Long', 'Boolean', 'Float', 'Double', 'Byte', 'Char', 'Short', 'CharSequence'].includes(name)) add(owner, [`get${name}(Ljava/lang/String;${type})${type}`]);
    if (['Parcelable', 'ParcelableArray', 'ParcelableArrayList', 'Serializable', 'SparseParcelableArray'].includes(name)) add(owner, [`get${name}(Ljava/lang/String;Ljava/lang/Class;)${name === 'Serializable' ? 'Ljava/io/Serializable;' : type}`]);   // Android 13 typed getters
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
for (const [name, parent] of Object.entries(WIDGET_PARENTS)) PARENTS.set(`Landroid/widget/${name};`, parent); PARENTS.set(LOCALE, 'Ljava/lang/Object;'); PARENTS.set(LOCALES, 'Ljava/lang/Object;'); PARENTS.set('Landroid/os/Parcelable$ClassLoaderCreator;', 'Landroid/os/Parcelable$Creator;');
PARENTS.set('Landroid/content/pm/ComponentInfo;', 'Landroid/content/pm/PackageItemInfo;'); PARENTS.set('Landroid/content/pm/PackageItemInfo;', 'Ljava/lang/Object;');
PARENTS.set(PACKAGE_MANAGER, 'Ljava/lang/Object;'); PARENTS.set(COMPONENT, 'Ljava/lang/Object;'); PARENTS.set(APPLICATION_INFO, 'Ljava/lang/Object;'); PARENTS.set(ACTIVITY_INFO, 'Ljava/lang/Object;');
PARENTS.set(CONFIGURATION, 'Ljava/lang/Object;'); PARENTS.set(METRICS, 'Ljava/lang/Object;');
PARENTS.set(INFLATER, 'Ljava/lang/Object;'); PARENTS.set(ATTRIBUTES, 'Landroid/util/AttributeSet;');
PARENTS.set(WINDOW, 'Ljava/lang/Object;'); PARENTS.set(PORTER_MODE, 'Ljava/lang/Enum;');
PARENTS.set('Landroid/view/ViewGroup;', 'Landroid/view/View;'); PARENTS.set('Landroid/widget/LinearLayout;', 'Landroid/view/ViewGroup;');
PARENTS.set(LAYOUT_PARAMS, 'Ljava/lang/Object;'); PARENTS.set(MARGIN_PARAMS, LAYOUT_PARAMS); PARENTS.set('Landroid/widget/LinearLayout$LayoutParams;', MARGIN_PARAMS); PARENTS.set('Landroid/widget/FrameLayout$LayoutParams;', MARGIN_PARAMS);
PARENTS.set(EDITABLE, 'Landroid/text/Editable;'); PARENTS.set('Landroid/text/Editable;', 'Ljava/lang/CharSequence;');
PARENTS.set(PROCESS_INFO, 'Ljava/lang/Object;');
PARENTS.set(HANDLER, 'Ljava/lang/Object;'); PARENTS.set(MESSAGE, 'Ljava/lang/Object;');
PARENTS.set(KEY_SET, 'Ljava/util/Set;'); PARENTS.set(KEY_ITERATOR, 'Ljava/util/Iterator;');
const descriptor = (name) => name?.startsWith('L') ? name : `L${name.replaceAll('.', '/')};`;
const sameRef = (a, b) => a != null && b != null && typeof a.ref === 'number' && a.ref === b.ref;
const nullish = (value) => value == null || value === 0;
function error(message, details = {}) { throw new APKError(`Android platform: ${message}`, { kind: 'android-platform-unsupported', ...details }); }
function floatBits(value) { const bits = new DataView(new ArrayBuffer(4)); bits.setFloat32(0, value, true); return bits.getInt32(0, true); }
function bitsFloat(value) { const bits = new DataView(new ArrayBuffer(4)); bits.setInt32(0, value, true); return bits.getFloat32(0, true); }
function checkString(value, context) { if (typeof value !== 'string') error(`${context} requires a real String`); return value; }

/** Explicit local Activity/Intent/Bundle and basic XML Views subset. Never bridges AndroidX. */
export class AndroidPlatform {
  constructor({ resources = null, applicationName = null, packageName = null, manifest = null, apkBytes = null, device = null } = {}) { this.device = resolveDevice(device || {}); this.clock = new VMClock(); this.apkBytes = apkBytes; this.manifest = manifest; this.resources = resources; this.applicationName = applicationName; this.packageName = packageName; this.application = null; this.applicationState = 'new'; this.frames = []; this.taskClosed = false; this.resourceObject = null; this.finishedActivities = new Set(); this.eventQueue = []; this.eventSequence = 0; this.virtualProcess = { source: 'browser-vm', pid: 1, uid: 10000, foreground: true }; this.transactionSequence = 0; this.porterModes = new Map(); this.inflaters = new Map(); this.applicationCallbacks = []; this.styleBackend = new AndroidStyleBackend(this); this.viewTreeHost = createViewTreeHost(this); this.viewWindowHost = createViewWindowHost(this); this.canvasHost = createVectorCanvasHost(); this.paintHost = createPaintHost(); this.contentHost = createContentResolverHost(this); this.drawableViewHost = createDrawableViewHost(this); this.deviceServices = createDeviceServicesHost(this); this.insetsHost = createWindowInsetsHost(this); this.accessibilityService = createAccessibilityServiceHost(this); this.viewLayoutHost = createViewLayoutHost(this); this.autofillService = createAutofillServiceHost(this); this.inputMethodService = createInputMethodServiceHost(); this.clipboardService = createClipboardServiceHost(this); this.viewInputHost = createViewInputHost(this); this.xmlHost = new AndroidXmlHost(this); this.localeService = createLocaleServiceHost(this); this.viewStateHost = createViewStateHost(); this.componentCallbacksHost = createComponentCallbacksHost(this); this.editableTextHost = createEditableTextHost(this); this.viewCoordinateHost = createViewCoordinateHost(this); this.viewTransformHost = createViewTransformHost(this); this.viewPropertyAnimatorHost = createViewPropertyAnimatorHost(this); this.viewOutlineHost = createViewOutlineHost(this); this.composeCanvasHost = createComposeCanvasHost(this); this.dialogWindowHost = createDialogWindowHost(this); this.systemServices = createSystemServicesHost(this); this.javaIo = createJavaIoHost(this); this.classLoaders = createClassLoaderHost(this); this.appServices = createAppServicesHost(this); this.concurrency = createConcurrencyHost(this); this.dateTime = createDateTimeHost(this); this.formatter = createFormatterHost(this); this.crypto = createCryptoHost(this); this.databaseSupport = createDatabaseSupportHost(this); this.shaderHost = createShaderHost(this); this.systemBarsHost = createSystemBarsHost(this); this.deviceState = createDeviceStateHost(this); this.jobScheduler = createJobSchedulerHost(this); this.pendingIntents = createPendingIntentHost(this); this.binderHost = createBinderHost(this); this.inputManagerHost = createInputManagerHost(this); this.contractHosts = [this.systemServices, this.javaIo, this.classLoaders, this.appServices, this.concurrency, this.dateTime, this.formatter, this.crypto, this.databaseSupport, this.shaderHost, this.deviceState, this.jobScheduler, this.pendingIntents, this.binderHost, this.inputManagerHost]; }
  readStatic(runtime, field) {
    for (const host of this.contractHosts) { const hosted = host.readStatic(runtime, field); if (hosted) return hosted; }
    // Android 13 Bundle.EMPTY: one singleton whose mMap is the immutable ArrayMap.EMPTY; any insertion throws UnsupportedOperationException("ArrayMap is immutable").
    if ((field.owner === BUNDLE || field.owner === 'Landroid/os/BaseBundle;') && field.name === 'EMPTY' && field.type === BUNDLE) { this.emptyBundles ??= new WeakMap(); if (!this.emptyBundles.has(runtime)) { const value = this.bundle(runtime); runtime.object(value).immutableEmpty = true; this.emptyBundles.set(runtime, value); } return { handled: true, value: this.emptyBundles.get(runtime) }; }
    if (field.owner === 'Landroid/view/View;' && field.type === 'Z' && ['sUseBrokenMakeMeasureSpec', 'sUseZeroUnspecifiedMeasureSpec'].includes(field.name)) { const target = Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1); return { handled: true, value: field.name === 'sUseBrokenMakeMeasureSpec' ? (target <= 17 ? 1 : 0) : (target < 23 ? 1 : 0) }; } // Original AOSP View.java compatibility assignments, derived from actual manifest target.
    if (field.owner === 'Landroid/provider/Settings$Secure;' && field.type === 'Ljava/lang/String;' && ['LONG_PRESS_TIMEOUT', 'MULTI_PRESS_TIMEOUT'].includes(field.name)) return { handled: true, value: field.name.toLowerCase() }; // Original Settings.Secure key names; values live in the VM core-settings store.
    if (field.owner === 'Landroid/os/Trace;' && field.name === 'TRACE_TAG_VIEW' && field.type === 'J') return { handled: true, value: 8n }; // AOSP Trace.java: 1L << 3
    if (field.owner === 'Landroid/view/View;' && field.type === 'Z' && field.name === 'sPreserveMarginParamsInLayoutParamConversion') return { handled: true, value: Number(this.manifest?.usesSdk?.targetSdkVersion ?? this.manifest?.usesSdk?.minSdkVersion ?? 1) >= 24 ? 1 : 0 };
    if (field.owner === LOCALE && ['US', 'UK', 'ENGLISH', 'ROOT'].includes(field.name)) return { handled: true, value: this.locale(runtime, { US: 'en-US', UK: 'en-GB', ENGLISH: 'en', ROOT: 'und' }[field.name]) };
    if (field.owner === PORTER_MODE) { const names = ['CLEAR', 'SRC', 'DST', 'SRC_OVER', 'DST_OVER', 'SRC_IN', 'DST_IN', 'SRC_OUT', 'DST_OUT', 'SRC_ATOP', 'DST_ATOP', 'XOR', 'DARKEN', 'LIGHTEN', 'MULTIPLY', 'SCREEN', 'ADD', 'OVERLAY']; if (names.includes(field.name)) { if (!this.porterModes.has(field.name)) { const ref = runtime.makeObject(PORTER_MODE); Object.assign(runtime.object(ref), { enumName: field.name, enumOrdinal: names.indexOf(field.name) }); this.porterModes.set(field.name, ref); } return { handled: true, value: this.porterModes.get(field.name) }; } }
    const build = { FINGERPRINT: 'apkweb/browser-vm/density1:28/compat/1:userdebug/test-keys', MODEL: 'APK Browser VM', MANUFACTURER: 'APK Browser Lab', BRAND: 'apkweb', DEVICE: 'browser', PRODUCT: 'browser-vm', HARDWARE: 'wasm-js', TYPE: 'userdebug', TAGS: 'test-keys', CPU_ABI: 'wasm32', CPU_ABI2: '', ID: 'APKWEB', DISPLAY: 'APKWEB browser compatibility VM' };
    if (field.owner === 'Landroid/os/Build;' && Object.hasOwn(build, field.name)) return { handled: true, value: build[field.name] };
    if (field.owner === 'Landroid/os/Build$VERSION;' && field.name === 'SDK_INT') return { handled: true, value: runtime.apiLevel };
    return null;
  }
  /** handleBindApplication. `stopAfter: 'attach'` (tests/tools) stops once Application.attach() ran; a later call continues with providers and onCreate. */
  beforeLaunch(runtime, { stopAfter = null } = {}) {
    if (this.applicationState === 'initialized') return;
    if (this.applicationState === 'failed') error('Application initialization previously failed; reopen the APK');
    const type = this.applicationName ? descriptor(this.applicationName) : APPLICATION;
    if (this.applicationName && (!runtime.dex.classes.has(type) || !runtime.isSubtype(type, APPLICATION))) error(`Manifest Application is unavailable or not an Application: ${type}`);
    const resuming = this.applicationState === 'attached';
    this.applicationState = 'initializing'; if (!resuming) this.systemServices.initializeSystemProperties(runtime);
    // ActivityThread.handleBindApplication: apps targeting API 11+ get StrictMode.enableDeathOnNetwork() on the main thread (network I/O there throws NetworkOnMainThreadException).
    if (!resuming && Number(this.manifest?.usesSdk?.targetSdkVersion ?? 1) > 10 && runtime.classes.has('Ldev/apkweb/net/MainThreadPolicy;'))
      runtime.dispatch({ owner: 'Ldev/apkweb/net/MainThreadPolicy;', name: 'install', signature: '()V', parameters: [], result: 'V' }, [], 'static');
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
  interfaces(type) { return [...this.contractHosts.flatMap(host => host.interfacesOf(type)), ...([INTENT, BUNDLE, 'Landroid/net/Uri;'].includes(type) ? ['Landroid/os/Parcelable;'] : []), ...([INTENT, BUNDLE].includes(type) ? ['Ljava/lang/Cloneable;'] : []), ...(type === 'Landroid/view/ViewGroup;' ? ['Landroid/view/ViewParent;', 'Landroid/view/ViewManager;'] : []), ...(type === ACTIVITY ? ['Landroid/view/LayoutInflater$Factory2;', 'Landroid/view/Window$Callback;'] : []), ...this.xmlHost.interfaces(type), ...(this.dialogWindowHost.interfaces?.(type) || []), ...(this.insetsHost.interfaces?.(type) || []), ...(this.viewWindowHost.interfaces(type) || []), ...this.drawableViewHost.interfaces(type)]; }
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
  }
  parent(type) { return this.contractHosts.reduce((found, host) => found || host.parent(type), null) || this.systemBarsHost.parent(type) || this.dialogWindowHost.parent(type) || this.viewCoordinateHost.parent(type) || this.viewStateHost.parent(type) || this.localeService.parent(type) || this.viewWindowHost.parent(type) || this.canvasHost.parent(type) || this.paintHost.parent(type) || this.contentHost.parent(type) || this.drawableViewHost.parent(type) || this.deviceServices.parent(type) || this.insetsHost.parent(type) || this.accessibilityService.parent(type) || this.autofillService.parent(type) || this.inputMethodService.parent(type) || this.clipboardService.parent(type) || this.viewInputHost.parent(type) || PARENTS.get(type) || null; }
  /** Implicit Object parents of contract-host classes: consulted only after the VM's EXTERNAL_PARENTS table. */
  fallbackParent(type) { return this.contractHosts.reduce((found, host) => found || host.fallbackParent(type), null); }
  canAllocate(type) { if (type === 'Landroid/view/View;') return true; return this.contractHosts.some(host => host.canAllocate(type)) || this.dialogWindowHost.canAllocate(type) || this.canvasHost.canAllocate(type) || this.paintHost.canAllocate(type) || this.contentHost.canAllocate(type) || this.drawableViewHost.canAllocate(type) || [LOCALE, LOCALES, PACKAGE_MANAGER, COMPONENT, APPLICATION_INFO, ACTIVITY_INFO, CONFIGURATION, METRICS, INFLATER, ATTRIBUTES, ...PARAM_TYPES, EDITABLE, ...Object.keys(WIDGET_PARENTS).map(name => `Landroid/widget/${name};`), FRAGMENT, FRAGMENT_MANAGER, TRANSACTION, APPLICATION, APP_CONTEXT, PROCESS_INFO, HANDLER, MESSAGE, INTENT, BUNDLE, 'Landroid/os/BaseBundle;', 'Landroid/os/PersistableBundle;', 'Landroid/content/res/Resources;'].includes(type); }
  supports(key) { return this.contractHosts.some(host => host.supports(key)) || this.systemBarsHost.supports(key) || this.dialogWindowHost.supports(key) || this.viewOutlineHost.supports(key) || this.composeCanvasHost.supports(key) || this.viewTransformHost.supports(key) || this.viewPropertyAnimatorHost.supports(key) || this.viewCoordinateHost.supports(key) || this.editableTextHost.supports(key) || this.componentCallbacksHost.supports(key) || this.viewStateHost.supports(key) || this.localeService.supports(key) || this.viewWindowHost.supports(key) || this.canvasHost.supports(key) || this.paintHost.supports(key) || this.contentHost.supports(key) || this.drawableViewHost.supports(key) || this.deviceServices.supports(key) || this.insetsHost.supports(key) || this.accessibilityService.supports(key) || this.viewLayoutHost.supports(key) || this.autofillService.supports(key) || this.inputMethodService.supports(key) || this.clipboardService.supports(key) || this.viewInputHost.supports(key) || KEYS.has(key) || STYLE_METHODS.has(key) || this.viewTreeHost.supports(key) || XML_METHODS.has(key); }
  viewKind(runtime, object) {
    const kind = this.drawableViewHost.viewKind(runtime, object); if (kind) return kind;
    for (const [name, containerKind] of [['ScrollView', 'scroll'], ['LinearLayout', 'linear'], ['FrameLayout', 'frame']]) if (runtime.isSubtype(object.type, `Landroid/widget/${name};`)) return containerKind;
    if (runtime.isSubtype(object.type, 'Landroid/view/ViewGroup;')) return 'group';
    if (object.type === 'Landroid/view/View;' || runtime.dex.classes.has(object.type) && runtime.isSubtype(object.type, 'Landroid/view/View;') && !['TextView', 'ProgressBar'].some(name => runtime.isSubtype(object.type, `Landroid/widget/${name};`))) return 'view';
    return null;
  }
  navigationState(runtime) { this.syncCurrent(runtime); const sourceBackHandler = !!runtime.activity && !!runtime.objectOverride(runtime.object(runtime.activity).type, 'onBackPressed()V'); return { sourceBackHandler, canGoBack: this.frames.length > 1 || sourceBackHandler, activityStack: this.frames.map((frame) => frame.type.slice(1, -1).replaceAll('/', '.')), closed: this.taskClosed }; }
  frame(runtime, activity = runtime.activity) {
    let frame = this.frames.find((entry) => sameRef(entry.activity, activity));
    if (!frame) {
      if (nullish(activity) || !runtime.isSubtype(runtime.object(activity).type, ACTIVITY)) error('Activity context is unavailable');
      frame = { activity, type: runtime.object(activity).type, root: sameRef(activity, runtime.activity) ? runtime.root : null, intent: null, finished: false };
      this.deviceState.applyAnimatorScale(runtime, this.device.animatorScale, true);
    this.frames.push(frame); this.taskClosed = false;
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
  dimension(attribute, runtime, floating = false) {
    const value = this.typedAttribute(attribute);
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
        case 'clipChildren': case 'clipToPadding': if (!runtime.isSubtype(type, 'Landroid/view/ViewGroup;') || typed.kind !== 'boolean') error(`XML ${attribute.name} requires a boolean on ViewGroup`); view[attribute.name] = !!typed.value; break;
        case 'textStyle': view.textStyle = typed.value; break;
        case 'textAllCaps': view.textAllCaps = !!typed.value; break;
        case 'singleLine': view.singleLine = !!typed.value; break;
        case 'minLines': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;') || !Number.isInteger(typed.value) || typed.value < 0) error('Invalid TextView minLines attribute'); runtime.dispatch({owner:'Landroid/widget/TextView;',name:'setMinLines',signature:'(I)V',parameters:['I'],result:'V'},[value,typed.value],'virtual'); break;
        case 'maxLines': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;') || !Number.isInteger(typed.value) || typed.value < 0) error('Invalid TextView maxLines attribute'); view.maxLines = typed.value; break;
        case 'progressTint': if (typed.kind !== 'color') error('Only scalar progressTint is supported'); view.progressTint = typed.value; break;
        case 'src': if (attribute.kind !== 'reference') error('ImageView src requires a real resource'); view.imageDrawable = this.styleBackend.loadDrawable(runtime, attribute.reference, this.styleBackend.theme(runtime, context)); runtime.dispatch({ owner: 'Landroid/graphics/drawable/Drawable;', name: 'setCallback', signature: '(Landroid/graphics/drawable/Drawable$Callback;)V', parameters: ['Landroid/graphics/drawable/Drawable$Callback;'], result: 'V' }, [view.imageDrawable, value], 'virtual'); break;
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
        case 'orientation': if (!runtime.isSubtype(type, names.LinearLayout) || ![0, 1].includes(typed.value)) error('XML orientation is only supported on LinearLayout'); view.orientation = typed.value; break;
        case 'text': if (!runtime.isSubtype(type, 'Landroid/widget/TextView;') || !['string', 'null'].includes(typed.kind)) error('XML text must resolve to a string on a TextView'); view.text = typed.value ?? ''; break;
        case 'textSize': if (type === names.LinearLayout) error('XML textSize requires TextView'); view.textSize = this.dimension(attribute, runtime, true); break;
        case 'textColor': if (typed.kind !== 'color') error('XML textColor must resolve to a scalar color'); view.textColor = typed.value; break;
        case 'enabled': if (typed.kind !== 'boolean') error('XML enabled must resolve to a boolean'); view.enabled = !!typed.value; break;
        case 'padding': { const size = this.dimension(attribute, runtime); view.padding = { left: size, top: size, right: size, bottom: size }; break; }
        case 'paddingLeft': case 'paddingRight': case 'paddingTop': case 'paddingBottom': view.padding[attribute.name.slice(7).toLowerCase()] = this.dimension(attribute, runtime); break;
        default: error(`Unsupported XML attribute android:${attribute.name} on <${node.name}>`, { kind: 'xml-attribute-unsupported', attribute: attribute.name, tag: node.name });
      }
    }
    // View constructor order: a background Drawable's padding is applied first; explicit android:padding* attributes win.
    if (node.attributes.some(attribute => attribute.name === 'background' && attribute.namespace === 'http://schemas.android.com/apk/res/android')) for (const attribute of node.attributes) {
      if (attribute.namespace !== 'http://schemas.android.com/apk/res/android') continue;
      if (attribute.name === 'padding') { const size = this.dimension(attribute, runtime); view.padding = { left: size, top: size, right: size, bottom: size }; }
      else if (['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].includes(attribute.name)) view.padding[attribute.name.slice(7).toLowerCase()] = this.dimension(attribute, runtime);
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
  startActivity(runtime, intentValue, resultCaller = null, requestCode = -1) {
    const intent = runtime.object(intentValue); this.syncCurrent(runtime);
    if (!intent.target) error(`External/implicit Intent${intent.action ? ` ${intent.action}` : ''} is unsupported; only explicit Activities packaged inside this APK can start`, { kind: 'external-intent-unsupported', action: intent.action ?? null });
    if (intent.flags) error(`Intent task flags 0x${(intent.flags >>> 0).toString(16)} require unsupported task-stack semantics`);
    const sourceFrame = this.frame(runtime);
    const target = descriptor(intent.target);
    if (!runtime.dex.classes.has(target) || !runtime.isSubtype(target, ACTIVITY)) error(`Intent target is not an Activity packaged in this APK: ${target}`, { kind: 'external-intent-unsupported', target });
    if (this.frames.length >= 32) error('Activity stack exceeds 32 frames');
    const sourceStarted = sourceFrame.lifecycleStage >= 3; if (sourceFrame.lifecycleStage === 4) this.lifecycleCall(runtime, sourceFrame.activity, 'onPause');
    const activity = runtime.allocate(target), delivered = runtime.makeObject(INTENT);
    Object.assign(runtime.object(delivered), { target, action: intent.action ?? null, flags: 0, data: intent.data ?? null, mimeType: intent.mimeType ?? null, extras: new Map(intent.extras || []), extrasPresent: !!intent.extrasPresent || !!intent.extras?.size, extrasClassLoader: intent.extrasClassLoader ?? null });
    const frame = { activity, type: target, root: null, intent: delivered, finished: false, resultReceiver: resultCaller && requestCode >= 0 ? resultCaller : null, resultRequestCode: requestCode };
    this.deviceState.applyAnimatorScale(runtime, this.device.animatorScale, true);
    this.frames.push(frame); this.taskClosed = false;
    runtime.activity = activity; runtime.activityType = target; runtime.root = null;
    runtime.record(`ACTIVITY start ${target}`);
    runtime.dispatch({ owner: target, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [activity], 'direct');
    this.attachActivityContext(runtime, activity);
    runtime.dispatch({ owner: target, name: 'onCreate', signature: '(Landroid/os/Bundle;)V', parameters: ['Landroid/os/Bundle;'], result: 'V' }, [activity, null], 'virtual');
    this.afterActivityCreate(runtime, activity); if (sourceStarted && this.frames.includes(sourceFrame)) this.lifecycleCall(runtime, sourceFrame.activity, 'onStop');
    frame.root = runtime.root;
    if (!frame.root && this.frames.includes(frame)) error(`Started Activity did not provide a content View: ${target}`);
  }
  deliverActivityResults(runtime, frame) {
    while (frame.pendingActivityResults?.length) {
      const result = frame.pendingActivityResults.shift(); runtime.record(`ACTIVITY result ${result.requestCode} code ${result.resultCode}`);
      runtime.dispatch({ owner: ACTIVITY, name: 'onActivityResult', signature: '(IILandroid/content/Intent;)V', parameters: ['I', 'I', INTENT], result: 'V' }, [frame.activity, result.requestCode, result.resultCode, result.data], 'virtual');
    }
  }
  finish(runtime, activity) {
    this.syncCurrent(runtime);
    const frame = this.frames.find(frame => sameRef(frame.activity, activity));
    if (!frame) { if (this.finishedActivities.has(activity.ref)) return; error('finish() receiver is not a registered Activity'); }
    if (frame.finishing) return; frame.finishing = true;
    const state = runtime.object(activity); let data = state.activityResultData ?? null;
    if (data) { const copy = runtime.allocate(INTENT); runtime.dispatch({ owner: INTENT, name: '<init>', signature: '(Landroid/content/Intent;)V', parameters: [INTENT], result: 'V' }, [copy, data], 'direct'); data = copy; }
    const result = { requestCode: frame.resultRequestCode, resultCode: state.activityResultCode ?? 0, data };
    if (frame.lifecycleStage === 4) this.lifecycleCall(runtime, frame.activity, 'onPause'); if (frame.lifecycleStage >= 3) this.lifecycleCall(runtime, frame.activity, 'onStop'); this.lifecycleCall(runtime, frame.activity, 'onDestroy');
    frame.finished = true; this.finishedActivities.add(frame.activity.ref); const index = this.frames.indexOf(frame); if (index >= 0) this.frames.splice(index, 1);
    const receiver = frame.resultReceiver && this.frames.find(candidate => sameRef(candidate.activity, frame.resultReceiver)); if (receiver) (receiver.pendingActivityResults ||= []).push(result);
    runtime.record(`ACTIVITY finish ${frame.type}`);
    if (!sameRef(runtime.activity, activity)) return; // A previous Splash may finish after starting a child.
    const previous = this.frames.at(-1);
    if (previous) { runtime.activity = previous.activity; runtime.activityType = previous.type; runtime.root = previous.root; if (previous.lifecycleStage === 2) this.lifecycleCall(runtime, previous.activity, 'onRestart'); if (previous.lifecycleStage <= 2) this.lifecycleCall(runtime, previous.activity, 'onStart'); this.deliverActivityResults(runtime, previous); this.lifecycleCall(runtime, previous.activity, 'onResume'); }
    else { runtime.activity = null; runtime.activityType = null; runtime.root = null; this.taskClosed = true; }
  }

  viewRoots(runtime) { return this.dialogWindowHost.roots(runtime); }
  back(runtime) { if(this.dialogWindowHost.back(runtime))return; if (!runtime.activity) error('No active Activity to navigate back from'); return runtime.dispatch({ owner: ACTIVITY, name: 'onBackPressed', signature: '()V', parameters: [], result: 'V' }, [runtime.activity], 'virtual'); }
  invoke(runtime, method, args) {
    const owner = method.owner, name = method.name, receiver = args[0];
    for (const host of this.contractHosts) if (host.supports(`${owner}->${name}${method.signature}`)) return host.invoke(runtime, method, args);
    if (this.systemBarsHost.supports(`${owner}->${name}${method.signature}`)) { if (owner === WINDOW && runtime.object(receiver).webPhoneWindow) return /^get/.test(name) ? (name.startsWith('is') ? 0 : 0) : undefined; return this.systemBarsHost.invoke(runtime, method, args); }
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
    if (owner === 'Landroid/os/StrictMode;') { if (!args[0] || !this.resources) error('LayoutInflater requires a resource configuration Context'); runtime.object(args[0]); runtime.record('CONTEXT configuration attached to explicit VM resource profile; StrictMode VM policy has no host penalties'); return; }
    if (owner === 'Landroid/app/ActivityManager;') { const fields = runtime.object(args[0]).fields, running = !this.taskClosed; for (const [field, value] of Object.entries({ pid: this.virtualProcess.pid, uid: this.virtualProcess.uid, importance: running ? 100 : 400, lastTrimLevel: 0, lru: 0, importanceReasonCode: 0, processState: this.frames.some(frame => frame.lifecycleStage === 4) ? 2 : 6 })) runtime.storeField(fields, `${PROCESS_INFO}->${field}:I`, value); runtime.record('PROCESS virtual foreground state (logical IDs; no host telemetry)'); return; }
    if (owner === PROCESS_INFO) {
      const fields = runtime.object(receiver).fields;
      if (!method.parameters.length) { runtime.storeField(fields, `${PROCESS_INFO}->importance:I`, 100); runtime.storeField(fields, `${PROCESS_INFO}->importanceReasonCode:I`, 0); runtime.storeField(fields, `${PROCESS_INFO}->processState:I`, 6); }
      else { runtime.storeField(fields, `${PROCESS_INFO}->processName:Ljava/lang/String;`, args[1]); runtime.storeField(fields, `${PROCESS_INFO}->pid:I`, args[2]); runtime.storeField(fields, `${PROCESS_INFO}->pkgList:[Ljava/lang/String;`, args[3]); }
      return;
    }
    if (owner === LOCALE) {
      if (name === 'getDefault') return this.locale(runtime, this.device.locale);
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
      if (name === 'get') return locales[args[1]] ?? null;
      if (name === 'size') return locales.length; if (name === 'isEmpty') return locales.length ? 0 : 1;
      if (name === 'indexOf') return locales.findIndex(locale => runtime.object(locale).localeData.tag === runtime.object(args[1]).localeData.tag);
      return locales.map(locale => runtime.object(locale).localeData.tag).join(',');
    }
    if (owner === PACKAGE_MANAGER) {
      if (name === 'hasSystemFeature') return 0; // This VM advertises no Android hardware features.
      if (name === 'getApplicationInfo') { if (args[1] !== this.packageName) error(`PackageManager has no external package ${args[1]}`); return this.applicationInfo(runtime, (Number(args[2]) & 128) !== 0); }
      const component = runtime.object(args[1]); if (component.packageName !== this.packageName) error('PackageManager can only query this APK');
      if(name==='getServiceInfo'){if(!this.manifest?.services?.includes(component.className))runtime.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;',component.className);error('ServiceInfo metadata transport is not installed for declared service '+component.className,{kind:'service-info-unsupported'});}
      const declaration = this.manifest?.activities?.find(activity => activity.name === component.className);
      if (!declaration) error(`Activity missing from actual manifest: ${component.className}`);
      const info = runtime.makeObject(ACTIVITY_INFO); const put = (name, type, value) => this.infoField(runtime, info, ACTIVITY_INFO, name, type, value);
      put('name', 'Ljava/lang/String;', declaration.name); put('packageName', 'Ljava/lang/String;', this.packageName); put('applicationInfo', APPLICATION_INFO, this.applicationInfo(runtime));
      put('configChanges', 'I', Number(declaration.configChanges || 0)); put('theme', 'I', Number(declaration.theme || this.manifest.application?.theme || 0)); put('exported', 'Z', declaration.exported === true || declaration.exported === 'true' ? 1 : 0); put('parentActivityName', 'Ljava/lang/String;', declaration.parentActivityName || null); put('permission', 'Ljava/lang/String;', declaration.permission || null); put('metaData', BUNDLE, null); return info;
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
    if (owner === HANDLER) return this.handlerInvoke(runtime, method, args);
    if (owner === MESSAGE) return this.messageInvoke(runtime, method, args);
    if (owner === KEY_SET || owner === KEY_ITERATOR) return this.keyViewInvoke(runtime, method, args);
    if (owner === INTENT) return this.intentInvoke(runtime, method, args);
    if (owner === BUNDLE || owner === 'Landroid/os/BaseBundle;' || owner === 'Landroid/os/PersistableBundle;') return this.bundleInvoke(runtime, method, args);
    if (CONTEXTS.includes(owner)) {
      if(name==='createConfigurationContext')return this.createConfigurationContext(runtime,receiver,args[1]);
      if (name === 'isRestricted') { let ref = receiver; const seen = new Set(); while (ref) { if (seen.has(ref.ref) || seen.size > 64) error('Cyclic ContextWrapper chain'); seen.add(ref.ref); const context = runtime.object(ref); if (context.contextFlags !== undefined) return context.contextFlags & 4 ? 1 : 0; ref = context.baseContext; } return 0; }
      if (name === 'getClassLoader') return runtime.applicationClassLoader ??= this.classLoaders.createApplicationLoader(runtime);
      if (name === 'getSystemService') { let serviceName = args[1]; if (method.parameters[0] === 'Ljava/lang/Class;') { const type = runtime.object(args[1]).classType; serviceName = ({ 'Landroid/view/LayoutInflater;': 'layout_inflater', 'Landroid/view/WindowManager;':'window', 'Landroid/view/accessibility/AccessibilityManager;': 'accessibility', 'Landroid/view/autofill/AutofillManager;': 'autofill', 'Landroid/content/ClipboardManager;': 'clipboard', 'Landroid/view/inputmethod/InputMethodManager;': 'input_method', 'Landroid/os/BatteryManager;': 'batterymanager', 'Landroid/net/ConnectivityManager;': 'connectivity', 'Landroid/app/job/JobScheduler;': 'jobscheduler', 'Landroid/telephony/TelephonyManager;': 'phone' })[type] ?? this.appServices.serviceNameForClass(type); if (!serviceName) error(`System service class ${type} is not installed in the virtual device`); } if (serviceName === 'layout_inflater') return this.inflater(runtime, receiver); const service = this.dialogWindowHost.getService(runtime,receiver,serviceName) || this.accessibilityService.getService(runtime, serviceName) || this.autofillService.getService(runtime, serviceName) || this.clipboardService.getService(runtime, serviceName) || this.inputMethodService.getService(runtime, serviceName) || this.deviceState.getService(runtime, serviceName) || this.jobScheduler.getService(runtime, serviceName) || this.appServices.getService(runtime, serviceName); if (service) return service; error(`System service ${serviceName} is not installed in the virtual device`); }
      if (owner === APPLICATION && name === 'registerActivityLifecycleCallbacks') { this.applicationCallbacks.push(args[1]); return; }
      if (owner === APPLICATION && name === 'unregisterActivityLifecycleCallbacks') { const index = this.applicationCallbacks.findIndex(ref => sameRef(ref, args[1])); if (index >= 0) this.applicationCallbacks.splice(index, 1); return; }
      if (owner === APPLICATION && (name === '<init>' || name === 'onCreate')) return; // Defined empty framework lifecycle bodies.
      if (name === 'getPackageManager') return this.packageManager ??= runtime.makeObject(PACKAGE_MANAGER);
      if (name === 'getApplicationInfo') return this.applicationInfo(runtime);
      if (name === 'getApplication' || name === 'getApplicationContext') { if (!this.application) error('Application lifecycle has not initialized'); return this.application; }
      if (name === 'getPackageName') { const packageName = this.packageName || this.resources?.table?.packages?.[0]?.name; if (!packageName) error('Manifest package name unavailable'); return packageName; }
      if (name === 'attachBaseContext' || name === '<init>' && owner === 'Landroid/content/ContextWrapper;') { runtime.object(receiver).baseContext = args[1]; return; }
      if (name === 'getBaseContext') return runtime.object(receiver).baseContext ?? null;
      if (name === '<init>') { this.frame(runtime, receiver); const base='Landroid/view/ContextThemeWrapper;';if(owner===ACTIVITY&&runtime.dex.bootClasses?.has(base))runtime.dispatch({owner:base,name:'<init>',parameters:[],result:'V',signature:'()V'},[receiver],'direct'); return; }
      if (name === 'onCreate') { const frame = this.frame(runtime, receiver); frame.lifecycleStage = 1; this.moveFragments(runtime, frame, 1); this.notifyActivity(runtime, frame, 'Created', args[1]); return; }
      if (name === 'getResources') return this.resourcesForContext(runtime,receiver);
      if (name === 'getString' || name === 'getText') return this.resource(args[1], ['string']).value;
      if (name === 'startActivity') return this.startActivity(runtime, args[1]);
      if (name === 'startActivityForResult') { if (args[3] && this.extras(runtime, args[3]).size) error('Non-empty Activity launch options require their original transition/window boundary'); return this.startActivity(runtime, args[1], receiver, args[2]); }
      if (name === 'setResult') { if (args[2] && !runtime.isSubtype(runtime.object(args[2]).type, INTENT)) error('Activity result data must be an Intent'); const object = runtime.object(receiver); object.activityResultCode = args[1]; object.activityResultData = args[2] || null; return; }
      if (name === 'onActivityResult') return; // Empty Activity base callback; APK/AndroidX overrides have DEX priority.
      if (name === 'isFinishing') return this.finishedActivities.has(receiver.ref) ? 1 : 0;
      if (name === 'isDestroyed') return this.finishedActivities.has(receiver.ref) || this.frames.find(frame => sameRef(frame.activity, receiver))?.destroyed ? 1 : 0;
      const frame = this.frame(runtime, receiver);
      if (name === 'getComponentName') { const component = runtime.makeObject(COMPONENT); Object.assign(runtime.object(component), { packageName: this.packageName, className: frame.type.slice(1, -1).replaceAll('/', '.') }); return component; }
      if (name === 'getLayoutInflater') return this.inflater(runtime, receiver);
      if (name === 'onCreateView') { if (method.parameters.length === 3) return null; if (args[2] === 'fragment') error('Native framework <fragment> inflation requires its Fragment inflater boundary'); return runtime.dispatch({ owner: ACTIVITY, name: 'onCreateView', signature: '(Ljava/lang/String;Landroid/content/Context;Landroid/util/AttributeSet;)Landroid/view/View;', parameters: ['Ljava/lang/String;', 'Landroid/content/Context;', 'Landroid/util/AttributeSet;'], result: 'Landroid/view/View;' }, [receiver, args[2], args[3], args[4]], 'virtual'); }
      if (name === 'getTitle') { const object = runtime.object(receiver); if (object.title !== undefined) return object.title; const declaration = this.manifest?.activities?.find(activity => activity.name === frame.type.slice(1, -1).replaceAll('/', '.')); const label = declaration?.label ?? this.manifest?.application?.label ?? declaration?.name ?? this.packageName; return object.title = typeof label === 'number' ? this.resource(label, ['string']).value : label; }
      if (name === 'setTitle') { runtime.object(receiver).title = method.parameters[0] === 'I' ? this.resource(args[1], ['string']).value : args[1]; return; }
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
    if (name === '<init>' && method.parameters[0] === 'Landroid/content/Context;') { object.context = args[1]; object.enabled = true; if(method.parameters[2]==='I')object.defStyleAttr=args[3]; if (runtime.isSubtype(object.type, 'Landroid/widget/TextView;')) object.textSize = Math.fround((runtime.isSubtype(object.type, 'Landroid/widget/EditText;') ? 18 : 14) * (this.device.fontScale || 1)); /* these defaults are sp values (scaledDensity = density * fontScale) */ this.drawableViewHost.applyThemeDefaults(runtime, receiver, args[2]); if (args[2] && runtime.object(args[2]).node) this.inflate(runtime, runtime.object(args[2]).node, args[1], 0, { existing: receiver, applyOnly: true }); this.syncViewFields(runtime, receiver); return; }
    if (owner === 'Landroid/content/res/Resources;') {
      if (name === 'getConfiguration') return this.resourceConfiguration(runtime,receiver);
      if(runtime.object(receiver).resourceConfigurationDifference)error('Resource selection for this changed configuration is not installed',{kind:'configuration-resources-unsupported',changes:runtime.object(receiver).resourceConfigurationDifference});
      if (name === 'getDisplayMetrics') return this.metrics(runtime);
      if (name === 'getIdentifier') {
        if (typeof args[1] !== 'string' || args[1].length > 4096) error('Resource name must be a bounded string');
        if (/^[0-9]+$/.test(args[1])) { const id = Number(args[1]); if (id > 0 && id <= 0x7fffffff) return id; }
        const full = /^(?:([^:]+):)?(?:([^/]+)\/)?([^/]+)$/.exec(args[1]); if (!full) return 0;
        const pkg = full[1] || args[3], type = full[2] || args[2]; if (!pkg || !type) return 0;
        const table = pkg === 'android' ? this.resources.frameworkTable : this.resources.table;
        return table?.findId(`${pkg}:${type}/${full[3]}`) || 0;
      }
      if (['getResourceName', 'getResourcePackageName', 'getResourceEntryName', 'getResourceTypeName'].includes(name)) {
        const id = args[1] >>> 0, table = (id >>> 24) === 1 ? this.resources.frameworkTable : this.resources.table;
        const identity = table?.entries.get(id)?.[0]; if (!identity) error(`Resource identity 0x${id.toString(16)} is absent`);
        return identity[{ getResourceName: 'fullName', getResourcePackageName: 'packageName', getResourceEntryName: 'name', getResourceTypeName: 'resourceType' }[name]];
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
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewRemoved', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); return;
      }
      if (name === 'removeView' || name === 'removeViewInLayout') {
        if (!object.children.some(child => sameRef(child, args[1]))) return;
        const child = runtime.object(args[1]); if (child.attached) { this.viewWindowHost.unfocusSubtree(runtime, args[1]); this.attachTree(runtime, args[1], false); }
        const index = object.children.findIndex(value => sameRef(value, args[1])); if (index < 0) return; object.children.splice(index, 1); if (sameRef(child.parent, receiver)) child.parent = null;
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewRemoved', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); this.requestDraw(runtime, receiver); if (object.laidOut && name !== 'removeViewInLayout') this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]); return;
      }
      if (name === 'addView' || name === 'addViewInLayout') {
        const inLayout = name === 'addViewInLayout', preventLayout = inLayout && !!args[4];
        if (inLayout && nullish(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot add a null child view to a ViewGroup');
        if (inLayout) runtime.object(args[1]).parent = null;
        const child = runtime.object(args[1]); if (child.parent) runtime.throwJava('Ljava/lang/IllegalStateException;', 'View already has a parent');
        const indexed = method.parameters?.[1] === 'I', at = indexed && args[2] >= 0 ? args[2] : object.children.length; if (at > object.children.length) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child index');
        let params = indexed ? args[3] : args[2]; params ||= child.layoutParams;
        if (!params) params = runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'generateDefaultLayoutParams', signature: '()Landroid/view/ViewGroup$LayoutParams;', parameters: [], result: LAYOUT_PARAMS }, [receiver], 'virtual');
        this.invoke(runtime, { owner: 'Landroid/view/View;', name: 'setLayoutParams' }, [args[1], params]); child.parent = receiver; object.children.splice(at, 0, args[1]); if (object.attached) this.attachTree(runtime, args[1], true);
        runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'onViewAdded', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [receiver, args[1]], 'virtual'); this.requestDraw(runtime, receiver);
        if (inLayout && !preventLayout) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [args[1]]);
        else if (!inLayout && object.laidOut) this.viewLayoutHost.invoke(runtime, { name: 'requestLayout' }, [receiver]);
        return inLayout ? 1 : undefined;
      }
    }
    if (name === 'addOnAttachStateChangeListener') { (object.attachListeners ||= []).push(args[1]); return; }
    if (name === 'removeOnAttachStateChangeListener') { const listeners = object.attachListeners || [], index = listeners.findIndex(ref => sameRef(ref, args[1])); if (index >= 0) listeners.splice(index, 1); return; }
    if (name === 'isAttachedToWindow') return object.attached ? 1 : 0;
    if (name === 'onAttachedToWindow' || name === 'onDetachedFromWindow') return;
    if (name === 'getParent') return object.parent ?? null;
    if (name === 'setWillNotDraw') { object.willNotDraw = !!args[1]; return; } if (name === 'willNotDraw') return object.willNotDraw ? 1 : 0;
    if (name === 'setImportantForAutofill') { object.importantForAutofill = args[1]; return; } if (name === 'getImportantForAutofill') return object.importantForAutofill || 0;
    if (name === 'setImportantForAccessibility') { object.importantForAccessibility = args[1]; return; } if (name === 'getImportantForAccessibility') return object.importantForAccessibility || 0;
    if (name === 'isInEditMode') return 0;
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
    if (name.startsWith('get')) {
      const type = method.result, typed = method.parameters[1] === 'Ljava/lang/Class;';
      const fallback = args.length > 2 && !typed ? args[2] : ['J', 'D'].includes(type) ? 0n : /^[ZIFBCS]$/.test(type) ? 0 : null;
      const found = this.get(runtime, args[0], args[1], typed && method.name !== 'getSerializable' ? this.extras(runtime, args[0]).get(args[1])?.type ?? type : type, fallback);
      if (typed && !nullish(found) && !nullish(args[2]) && !runtime.isSubtype(runtime.typeOf(found), runtime.object(args[2]).classType ?? 'Ljava/lang/Object;') && !Array.isArray(runtime.object(found).elements)) return null;   // BaseBundle.getValue(key, clazz): a mismatched type is warned about and read as null
      return found;
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
    if (['Created', 'SaveInstanceState'].includes(event)) { parameters.push(BUNDLE); values.push(bundle || null); }
    for (const callback of [...this.applicationCallbacks]) runtime.dispatch({ owner: runtime.object(callback).type, name: `onActivity${event}`, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [callback, ...values], 'virtual');
  }
  lifecycleCall(runtime, receiver, name, parameters = [], values = []) {
    const activity = runtime.isSubtype(runtime.object(receiver).type, ACTIVITY), frame = activity ? this.frames.find(frame => sameRef(frame.activity, receiver)) : null;
    const before = { onPause: 3, onStop: 2, onDestroy: 0 };
    if (frame && Object.hasOwn(before, name)) { if (name === 'onDestroy') frame.destroyed = true; this.moveFragments(runtime, frame, before[name]); }
    const result = runtime.dispatch({ owner: runtime.object(receiver).type, name, signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [receiver, ...values], 'virtual');
    // ActivityThread.handleDestroyActivity: fragments and Activity.onDestroy run first (Compose disposes its compositions there), the window is removed afterwards.
    if (frame && name === 'onDestroy') { if (frame.root) this.viewWindowHost.unfocusSubtree(runtime, frame.root); this.attachTree(runtime, frame.root, false); this.dialogWindowHost.activityDestroyed(runtime, receiver); }
    if (frame && name === 'onStart') this.moveFragments(runtime, frame, 3);
    if (frame && name === 'onResume') { this.moveFragments(runtime, frame, 4); this.lifecycleCall(runtime, receiver, 'onPostResume'); }
    return result;
  }
  afterActivityCreate(runtime, activity = runtime.activity) {
    if (this.finishedActivities.has(activity?.ref)) return; const frame = this.frame(runtime, activity); if (frame.lifecycleStage >= 2) return; frame.lifecycleStage = 2; this.moveFragments(runtime, frame, 2);
    this.lifecycleCall(runtime, activity, 'onStart'); if (frame.savedState) this.lifecycleCall(runtime, activity, 'onRestoreInstanceState', [BUNDLE], [frame.savedState]); this.lifecycleCall(runtime, activity, 'onPostCreate', [BUNDLE], [frame.savedState || null]); this.lifecycleCall(runtime, activity, 'onResume'); if (runtime.activity && sameRef(runtime.activity, activity)) { this.attachTree(runtime, frame.root, true); this.viewTreeHost.dispatchFrame(runtime, frame.root, () => { this.drawableViewHost.drawTree(runtime, frame.root); this.composeCanvasHost.renderTree(runtime, frame.root); }); }
  }
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
  queueTask(callback, delay = 0, roots = undefined) {
    if (this.eventQueue.length >= 1024) error('Framework event queue exceeds 1024');
    this.eventQueue.push({ when: this.clock.now() + delay, sequence: ++this.eventSequence, front: false, platformTask: callback, ...(roots !== undefined ? { roots } : {}) });
    this.eventQueue.sort((a, b) => a.front !== b.front ? a.front ? -1 : 1 : a.front ? b.sequence - a.sequence : a.when - b.when || a.sequence - b.sequence);
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
    if (!this.frames.includes(frame)) return; this.syncCurrent(runtime); frame.changingConfiguration = true;
    if (frame.lifecycleStage === 4) this.lifecycleCall(runtime, frame.activity, 'onPause'); this.lifecycleCall(runtime, frame.activity, 'onStop'); const saved = this.bundle(runtime);
    this.lifecycleCall(runtime, frame.activity, 'onSaveInstanceState', [BUNDLE], [saved]);
    const retained = runtime.dispatch({ owner: frame.type, name: 'onRetainNonConfigurationInstance', signature: '()Ljava/lang/Object;', parameters: [], result: 'Ljava/lang/Object;' }, [frame.activity], 'virtual');
    const retainedFragments = frame.fragmentManager ? runtime.object(frame.fragmentManager).fragments.filter(ref => runtime.object(ref).retained) : [];
    for (const fragment of retainedFragments) runtime.object(fragment).retaining = true;
    this.lifecycleCall(runtime, frame.activity, 'onDestroy');
    const activity = runtime.allocate(frame.type), replacement = { activity, type: frame.type, intent: frame.intent, root: null, retained, lifecycleStage: 0, savedState: saved };
    this.frames.splice(this.frames.indexOf(frame), 1, replacement); this.finishedActivities.add(frame.activity.ref);
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
    put('packageName', 'Ljava/lang/String;', this.packageName); put('name', 'Ljava/lang/String;', this.applicationName); put('theme', 'I', Number(app.theme || 0)); put('targetSdkVersion', 'I', Number(this.manifest.usesSdk?.targetSdkVersion || 1)); put('uid', 'I', this.virtualProcess.uid);
    // ApplicationInfo install locations as PackageManager reports them for a package installed from this APK (virtual filesystem paths).
    const pkg = this.packageName, code = this.javaIo.fs().codePath, data = `/data/user/0/${pkg}`;
    for (const [name, value] of Object.entries({ sourceDir: `${code}/base.apk`, publicSourceDir: `${code}/base.apk`, dataDir: data, deviceProtectedDataDir: `/data/user_de/0/${pkg}`, credentialProtectedDataDir: data, nativeLibraryDir: `${code}/lib/wasm32`, processName: pkg, taskAffinity: pkg })) put(name, 'Ljava/lang/String;', value);
    // FLAG_DEBUGGABLE=2, FLAG_HAS_CODE=4, FLAG_ALLOW_CLEAR_USER_DATA=0x40, FLAG_INSTALLED=1<<23, FLAG_EXTRACT_NATIVE_LIBS=1<<28 (default when extractNativeLibs is not declared false).
    const isFalse = value => value === false || value === 'false' || value === 0, hasCode = !isFalse(app.hasCode);
    put('flags', 'I', (app.debuggable === true || app.debuggable === 'true' ? 2 : 0) | (hasCode ? 4 : 0) | 0x40 | (1 << 23) | (isFalse(app.extractNativeLibs) ? 0 : (1 << 28)));
    put('minSdkVersion', 'I', Number(this.manifest.usesSdk?.minSdkVersion || 1)); put('enabled', 'Z', 1);
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
    const key = context.ref; if (this.inflaters.has(key)) return this.inflaters.get(key);
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
  moveFragment(runtime, value, target) {
    const fragment = runtime.object(value); let state = fragment.fragmentStage || 0;
    while (state < target) {
      const next = state + 1;
      if (next === 1) { this.fragmentCall(runtime, value, 'onAttach', ['Landroid/content/Context;'], [fragment.host]); if (!fragment.skipCreateOnce) this.fragmentCall(runtime, value, 'onCreate', [BUNDLE], [null]); fragment.skipCreateOnce = false; }
      if (next === 2) { const frame = this.frame(runtime, fragment.host); const container = fragment.containerId ? this.find(runtime, frame.root, fragment.containerId) : null; fragment.root = runtime.dispatch({ owner: runtime.object(value).type, name: 'onCreateView', signature: '(Landroid/view/LayoutInflater;Landroid/view/ViewGroup;Landroid/os/Bundle;)Landroid/view/View;', parameters: [INFLATER, 'Landroid/view/ViewGroup;', BUNDLE], result: 'Landroid/view/View;' }, [value, this.inflater(runtime, fragment.host), container, frame.savedState || null], 'virtual'); if (!nullish(fragment.root)) { if (container) runtime.dispatch({ owner: 'Landroid/view/ViewGroup;', name: 'addView', signature: '(Landroid/view/View;)V', parameters: ['Landroid/view/View;'], result: 'V' }, [container, fragment.root], 'virtual'); this.fragmentCall(runtime, value, 'onViewCreated', ['Landroid/view/View;', BUNDLE], [fragment.root, frame.savedState || null]); } this.fragmentCall(runtime, value, 'onActivityCreated', [BUNDLE], [frame.savedState || null]); }
      if (next === 3) this.fragmentCall(runtime, value, 'onStart');
      if (next === 4) this.fragmentCall(runtime, value, 'onResume');
      state = fragment.fragmentStage = next;
    }
    while (state > target) {
      if (state === 4) this.fragmentCall(runtime, value, 'onPause');
      if (state === 3) this.fragmentCall(runtime, value, 'onStop');
      if (state === 2 && fragment.root) { this.fragmentCall(runtime, value, 'onDestroyView'); const parent = runtime.object(fragment.root).parent; if (parent) runtime.object(parent).children = runtime.object(parent).children.filter(ref => !sameRef(ref, fragment.root)); fragment.root = null; }
      if (state === 1) { if (!fragment.retaining) this.fragmentCall(runtime, value, 'onDestroy'); this.fragmentCall(runtime, value, 'onDetach'); }
      state = fragment.fragmentStage = state - 1;
    }
  }
  moveFragments(runtime, frame, target) {
    if (!frame.fragmentManager) return;
    const manager = runtime.object(frame.fragmentManager);
    for (const fragment of manager.fragments) this.moveFragment(runtime, fragment, target);
    manager.destroyed = target === 0;
  }
  executeTransactions(runtime, managerValue) {
    const manager = runtime.object(managerValue); if (manager.destroyed) error('FragmentManager has been destroyed'); let executed = false;
    while (manager.pending.length) {
      const transaction = manager.pending.shift();
      for (const operation of transaction.operations) {
        const fragment = runtime.object(operation.fragment);
        if (operation.kind === 'add') {
          if (fragment.manager) error('Fragment is already added');
          Object.assign(fragment, { manager: managerValue, host: manager.host, tag: operation.tag, containerId: operation.containerId, added: true, fragmentStage: 0 }); manager.fragments.push(operation.fragment);
          const frame = this.frame(runtime, manager.host); this.moveFragment(runtime, operation.fragment, frame.lifecycleStage || 0);
        } else { this.moveFragment(runtime, operation.fragment, 0); manager.fragments = manager.fragments.filter((value) => !sameRef(value, operation.fragment)); fragment.added = false; fragment.manager = null; }
      }
      executed = true;
    }
    return executed ? 1 : 0;
  }
  fragmentInvoke(runtime, method, args) {
    const owner = method.owner, name = method.name, value = args[0], object = runtime.object(value);
    if (owner === FRAGMENT_MANAGER) {
      if (name === 'findFragmentByTag') return [...object.fragments].reverse().find((ref) => runtime.object(ref).tag === args[1]) ?? null;
      if (name === 'beginTransaction') { const transaction = runtime.makeObject(TRANSACTION); Object.assign(runtime.object(transaction), { manager: value, operations: [], committed: false }); return transaction; }
      if (name === 'executePendingTransactions') return this.executeTransactions(runtime, value);
      if (name === 'isDestroyed') return object.destroyed ? 1 : 0;
    }
    if (owner === TRANSACTION) {
      if (object.committed) error('FragmentTransaction is already committed');
      if (name === 'add' || name === 'remove') { object.operations.push({ kind: name, fragment: typeof args[1] === 'number' ? args[2] : args[1], tag: typeof args[1] === 'number' ? args[3] : args[2], containerId: typeof args[1] === 'number' ? args[1] : 0 }); return value; }
      object.committed = true; const manager = runtime.object(object.manager); manager.pending.push(object); const id = ++this.transactionSequence;
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
    if (name === 'onDetach') { object.host = null; return; }
    if (name === 'onAttach' && method.parameters[0] === 'Landroid/content/Context;') return this.fragmentCall(runtime, value, 'onAttach', [ACTIVITY], [args[1]]);
    if (name.startsWith('on')) return; // Framework base Fragment lifecycle methods have no user callback body.
    error(`Unsupported framework Fragment operation ${name}`);
  }
  messageField(runtime, message, name, type, value) {
    const object = runtime.object(message), key = `${MESSAGE}->${name}:${type}`;
    if (arguments.length === 5) { runtime.storeField(object.fields, key, value); return value; }
    return object.fields.get(key) ?? (type.startsWith('L') ? null : 0);
  }
  newMessage(runtime, target = null, values = []) {
    const message = runtime.makeObject(MESSAGE), object = runtime.object(message);
    object.target = target; object.messageCallback = null; object.when = 0; object.inUse = false; object.recycled = false;
    if (values.length) this.messageField(runtime, message, 'what', 'I', values[0]);
    if (values.length >= 3) { this.messageField(runtime, message, 'arg1', 'I', values[1]); this.messageField(runtime, message, 'arg2', 'I', values[2]); }
    if (values.length === 2 || values.length === 4) this.messageField(runtime, message, 'obj', 'Ljava/lang/Object;', values.at(-1));
    return message;
  }
  /** The pending-message array of a Looper: the platform event queue for the main Looper, the Looper object's own queue for the Looper of another thread (HandlerThread). */
  queueOf(runtime, looper) { return sameRef(looper, runtime.mainLooper) || !runtime.object(looper).looperQueue ? this.eventQueue : runtime.object(looper).looperQueue; }
  enqueue(runtime, handler, message, when, front = false) {
    const owner = runtime.object(handler), object = runtime.object(message);
    if (!runtime.isSubtype(owner.type, HANDLER) || object.type !== MESSAGE) error('Handler enqueue requires Handler and Message');
    if (object.inUse || object.recycled) error('Message is already queued or recycled');
    const queue = this.queueOf(runtime, owner.looper);
    if (queue.length >= 1024) error('Handler queue exceeds 1024 messages', { kind: 'messagequeue-limit' });
    if (runtime.object(owner.looper).quitting) { runtime.record('HANDLER enqueue refused: the Looper is quitting'); return 0; }   // MessageQueue.enqueueMessage: "sending message to a Handler on a dead thread"
    if (!Number.isFinite(when) || Math.abs(when) > Number.MAX_SAFE_INTEGER) error('Handler message time exceeds supported clock range');
    object.async = !!object.async || !!owner.async; object.target = handler; object.when = Math.max(0, Math.floor(when)); object.inUse = true;
    queue.push({ handler, message, when: object.when, sequence: ++this.eventSequence, front });
    queue.sort((a, b) => a.front !== b.front ? a.front ? -1 : 1 : a.front ? b.sequence - a.sequence : a.when - b.when || a.sequence - b.sequence);
    runtime.record(`HANDLER enqueue ${message.ref} at ${object.when}`); return 1;
  }
  nextEventDelay(now = this.clock.now()) {
    const event = this.eventQueue[0]; let delay = event ? event.front ? 0 : Math.max(0, event.when - now) : null;
    if (this.externalSources) for (const source of this.externalSources) { const external = source.delay(); if (external !== null && (delay === null || external < delay)) delay = external; }   // e.g. a network exchange that made progress
    return delay;
  }
  /** Registers a source of work that completes outside the VM (network I/O): `delay()` is 0 when it has progress to deliver, `pending()` counts exchanges still in flight. */
  addExternalSource(source) { (this.externalSources ??= new Set()).add(source); }
  drainEvents(runtime, { now = this.clock.now(), maxEvents = 32 } = {}) {
    if (!Number.isFinite(now) || !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 256) error('Invalid bounded message queue drain');
    let processed = 0;
    maybeCollect(runtime);   // quiescent point between host events: reclaim unreachable Java objects when the heap is filling (every call under APKWEB_GC_AUDIT=1)
    if (this.externalSources) for (const source of this.externalSources) source.drained?.();
    while (processed < maxEvents && this.eventQueue.length && (this.eventQueue[0].front || this.eventQueue[0].when <= now)) {
      const event = this.eventQueue.shift();
      if (event.platformTask) { runtime.steps = 0; event.platformTask(); processed++; continue; }
      const object = runtime.object(event.message);
      runtime.steps = 0; runtime.record(`HANDLER dispatch ${event.message.ref}`);
      try { runtime.dispatch({ owner: HANDLER, name: 'dispatchMessage', signature: '(Landroid/os/Message;)V', parameters: [MESSAGE], result: 'V' }, [event.handler, event.message], 'virtual'); }
      finally { object.inUse = false; object.recycled = true; }
      processed++;
    }
    // Green threads (Thread.start, pool workers) run in slices after the queued events; each slice is bounded so a spinning thread cannot starve the event queue.
    for (let slices = 0; runtime.multiThreaded && slices < 64 && runtime.scheduler.hasRunnable(); slices++) { runtime.steps = 0; runtime.runThreads(); processed++; }
    const eventDelay = this.nextEventDelay(), threadDelay = runtime.scheduler.threadDelay();
    let waitingIO = 0; if (this.externalSources) for (const source of this.externalSources) waitingIO += source.pending?.() ?? 0;
    return { processed, pending: this.eventQueue.length, waitingIO, nextDelay: eventDelay === null ? threadDelay : threadDelay === null ? eventDelay : Math.min(eventDelay, threadDelay) };
  }
  handlerInvoke(runtime, method, args) {
    const name = method.name;
    if (name === 'createAsync') { const value = runtime.makeObject(HANDLER), object = runtime.object(value); object.looper = args[0]; object.callback = args[1] ?? null; object.async = true; return value; }
    const value = args[0], object = runtime.object(value);
    if (name === '<init>') {
      const explicit = method.parameters[0] === 'Landroid/os/Looper;';
      object.looper = explicit ? args[1] : runtime.mainLooper ??= runtime.makeObject('Landroid/os/Looper;');
      if (nullish(object.looper)) error('Handler requires a Looper');
      object.callback = explicit ? method.parameters[1] === 'Landroid/os/Handler$Callback;' ? args[2] : null : method.parameters[0] === 'Landroid/os/Handler$Callback;' ? args[1] : null;
      object.async = method.parameters.at(-1) === 'Z' ? !!args.at(-1) : false; return;
    }
    if (name === 'getLooper') return object.looper;
    if (name === 'obtainMessage') return this.newMessage(runtime, value, args.slice(1));
    if (name === 'handleMessage') return; // Android's base implementation intentionally has an empty body.
    if (name === 'dispatchMessage') {
      const message = runtime.object(args[1]);
      if (message.messageCallback) return runtime.dispatch({ owner: runtime.object(message.messageCallback).type, name: 'run', signature: '()V', parameters: [], result: 'V' }, [message.messageCallback], 'virtual');
      if (!nullish(object.callback)) {
        const handled = runtime.dispatch({ owner: runtime.object(object.callback).type, name: 'handleMessage', signature: '(Landroid/os/Message;)Z', parameters: [MESSAGE], result: 'Z' }, [object.callback, args[1]], 'virtual');
        if (handled) return;
      }
      return runtime.dispatch({ owner: HANDLER, name: 'handleMessage', signature: '(Landroid/os/Message;)V', parameters: [MESSAGE], result: 'V' }, [value, args[1]], 'virtual');
    }
    const matches = (event) => {
      if (!sameRef(event.handler, value)) return false;
      const message = runtime.object(event.message), token = this.messageField(runtime, event.message, 'obj', 'Ljava/lang/Object;');
      if (name.includes('CallbacksAndMessages')) return nullish(args[1]) || sameRef(token, args[1]) || token === args[1];
      if (name.includes('Callbacks')) return sameRef(message.messageCallback, args[1]) && (args.length < 3 || sameRef(token, args[2]) || token === args[2]);
      return this.messageField(runtime, event.message, 'what', 'I') === args[1] && (args.length < 3 || sameRef(token, args[2]) || token === args[2]);
    };
    const looperObject = runtime.object(object.looper), ownQueue = !sameRef(object.looper, runtime.mainLooper) && looperObject.looperQueue;
    if (name.startsWith('has')) return (ownQueue || this.eventQueue).some(matches) ? 1 : 0;
    if (name.startsWith('remove') && ownQueue) { looperObject.looperQueue = ownQueue.filter((event) => { if (!matches(event)) return true; const message = runtime.object(event.message); message.inUse = false; message.recycled = true; return false; }); return; }
    if (name.startsWith('remove')) { this.eventQueue = this.eventQueue.filter((event) => { if (!matches(event)) return true; const message = runtime.object(event.message); message.inUse = false; message.recycled = true; return false; }); return; }
    let message, time = this.clock.now();
    if (name.startsWith('post')) {
      if (nullish(args[1])) error('Handler.post requires a Runnable');
      message = this.newMessage(runtime, value); runtime.object(message).messageCallback = args[1];
      if (method.parameters[1] === 'Ljava/lang/Object;') this.messageField(runtime, message, 'obj', 'Ljava/lang/Object;', args[2]);
      if (name === 'postDelayed') time += Math.max(0, Number(args.at(-1)));
      if (name === 'postAtTime') time = Number(args.at(-1));
    } else {
      message = name.startsWith('sendEmpty') ? this.newMessage(runtime, value, [args[1]]) : args[1];
      if (name.endsWith('Delayed')) time += Math.max(0, Number(args.at(-1)));
      if (name.endsWith('AtTime')) time = Number(args.at(-1));
    }
    return this.enqueue(runtime, value, message, time, name.endsWith('AtFrontOfQueue'));
  }
  messageInvoke(runtime, method, args) {
    const name = method.name;
    if (name === 'obtain') {
      if (!method.parameters.length) return this.newMessage(runtime);
      if (method.parameters[0] === MESSAGE) { const value = this.newMessage(runtime); this.copyMessage(runtime, value, args[0]); const original = runtime.object(args[0]), copy = runtime.object(value); copy.target = original.target; copy.messageCallback = original.messageCallback; copy.async = false; return value; }
      const value = this.newMessage(runtime, args[0], method.parameters[1] === 'Ljava/lang/Runnable;' ? [] : args.slice(1));
      if (method.parameters[1] === 'Ljava/lang/Runnable;') runtime.object(value).messageCallback = args[1]; return value;
    }
    const value = args[0], object = runtime.object(value);
    if (name === '<init>') { object.target = null; object.inUse = false; object.recycled = false; object.when = 0; return; }
    if (name === 'setTarget') { object.target = args[1]; return; }
    if (name === 'getTarget') return object.target ?? null;
    if (name === 'getCallback') return object.messageCallback ?? null;
    if (name === 'getWhen') return BigInt(object.when || 0);
    if (name === 'setAsynchronous') { object.async = !!args[1]; return; }
    if (name === 'isAsynchronous') return object.async ? 1 : 0;
    if (name === 'getData') return object.data ??= this.bundle(runtime);
    if (name === 'peekData') return object.data ?? null;
    if (name === 'setData') { object.data = args[1]; return; }
    if (name === 'copyFrom') return this.copyMessage(runtime, value, args[1]);
    if (name === 'recycle') { if (object.inUse) error('Cannot recycle a queued Message'); object.recycled = true; return; }
    if (name === 'sendToTarget') { if (!object.target) error('Message has no target Handler'); this.enqueue(runtime, object.target, value, performance.now()); return; }
    error(`Unsupported Message operation ${name}`);
  }
  copyMessage(runtime, target, source) {
    const destination = runtime.object(target), original = runtime.object(source);
    for (const [key, value] of original.fields) runtime.storeField(destination.fields, key, value);
    destination.async = original.async;
    destination.data = original.data ? this.bundle(runtime, this.extras(runtime, original.data)) : null;
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
      if (method.parameters[0] === INTENT) { const source = runtime.object(args[1]); Object.assign(intent, { extras: new Map(source.extras || []), extrasPresent: !!source.extrasPresent || !!source.extras?.size, extrasClassLoader: source.extrasClassLoader ?? null, flags: source.flags || 0, action: source.action, target: source.target, data: source.data ?? null, mimeType: source.mimeType ?? null }); }
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
    if (name.startsWith('get') && name.endsWith('Extra') && method.parameters[1] === 'Ljava/lang/Class;') {
      // API 33 typed getters (getParcelableExtra(name, Class) ...): null when the key is absent or the value is not an instance of the class.
      const found = this.get(runtime, value, args[1], method.result, null), wanted = runtime.object(args[2])?.classType;
      return found === null || found === undefined || !wanted || (typeof found === 'object' && found.ref !== undefined && !runtime.isSubtype(runtime.typeOf(found), wanted)) ? null : found;
    }
    if (name.startsWith('get') && name.endsWith('Extra')) { const fallback = args.length > 2 ? args[2] : null; return this.get(runtime, value, args[1], method.result, fallback); }
    error(`Unsupported Intent operation ${name}`);
  }
}
