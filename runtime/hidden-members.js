import TABLES from './hidden-member-tables.js?v=0feec282e5a9';
import { APKError } from './apk-error.js?v=0feec282e5a9';
import { constantField } from './framework-constants.js?v=0feec282e5a9';

/**
 * Reflection over the members of host-modelled framework classes (Handler, Looper, Message, ActivityThread, Activity, View ...) that apps and libraries reach with
 * Class.getDeclaredField("mH") and friends. The member tables (hidden-member-tables.js, generated from the pinned android-13.0.0_r1 sources) say what exists, with type, modifiers and
 * declaring class: a member that is not in them does not exist on Android 13 and the lookup throws the NoSuchFieldException / NoSuchMethodException of ART.
 *
 * Values: where the VM models the object the accessors below read and write the real state (Handler.mCallback is the callback Handler.dispatchMessage consults, ActivityThread.mH is the
 * main-looper Handler, MessageQueue.mMessages is the head of the main queue ...). Every other tabled instance field is shadow storage on the object, initialised to the Java default, so a
 * library that writes a field reads its own value back; static fields are shadowed in the runtime's static table. Hidden-API denial (the greylist) is not enforced: every member of the
 * tables is reachable, as for a debuggable app on a device with the restriction lifted. ActivityThread's H lifecycle messages (EXECUTE_TRANSACTION ...) are not modelled: the lab drives
 * lifecycle callbacks itself, so a callback swapped into mH sees only messages posted to it.
 */
const index = new Map();
const entry = owner => {
  let cached = index.get(owner); if (cached !== undefined) return cached;
  const table = TABLES[owner]; cached = table ? { fields: new Map(table.fields.map(row => [row[0], row])), methods: table.methods } : null;
  index.set(owner, cached); return cached;
};
export const isTabled = owner => entry(owner) !== null;
const key = (owner, name, type) => `${owner}->${name}:${type}`;

/**
 * The instance fields of libcore's java.lang.reflect classes that an app can discover on Android 13. libcore declares more (Executable: accessFlags, artMethod, declaringClass,
 * declaringClassOfOverriddenMethod, dexMethodIndex, hasRealParameterData, parameters; Field: accessFlags, declaringClass, artFieldIndex, offset, type; AccessibleObject: override;
 * Constructor: serializationClass, serializationCtor), and ART's hidden-API check filters them by their flag for a caller in the app's domain (Class.getDeclaredFields, getDeclaredField,
 * JNI GetFieldID): only the members annotated @UnsupportedAppUsage in libcore's ojluni/annotations/hiddenapi stubs ("unsupported", no maxTargetSdk) are visible; the rest are "blocked",
 * absent from getDeclaredFields and a NoSuchFieldException for getDeclaredField (src/boot-class-members.js). Rows: [name, type, access flags]. Fields only: the methods of these classes
 * stay the bridge's (they are not a complete member table, so isTabled is false for them).
 */
const REFLECT_FIELDS = new Map([
  ['Ljava/lang/reflect/Executable;', [['artMethod', 'J', 0x2]]],
  ['Ljava/lang/reflect/Field;', [['accessFlags', 'I', 0x2]]],
  ['Ljava/lang/reflect/AccessibleObject;', [['override', 'Z', 0]]],
]);
const reflectField = (owner, row) => ({ field: { owner, name: row[0], type: row[1], key: key(owner, row[0], row[1]) }, flags: row[2] });

/** A reflection member for runtime.reflectionLookup, or null. kind: 'field' | 'method' | 'constructor'. */
export function hiddenReflection(owner, kind, name, parameters, publicOnly) {
  if (kind === 'field' && REFLECT_FIELDS.has(owner)) { const row = REFLECT_FIELDS.get(owner).find(item => item[0] === name); return row && !publicOnly ? reflectField(owner, row) : null; }
  const table = entry(owner); if (!table) return null;
  if (kind === 'field') {
    const row = table.fields.get(name); if (!row || (publicOnly && !(row[2] & 1))) return null;
    return { field: { owner, name, type: row[1], key: key(owner, name, row[1]) }, flags: row[2] };
  }
  const wanted = (parameters ?? []).join(''), methodName = kind === 'constructor' ? '<init>' : name;
  const row = table.methods.find(item => item[0] === methodName && item[1].join('') === wanted); if (!row || (publicOnly && !(row[3] & 1))) return null;
  const signature = `(${wanted})${row[2]}`;
  return { method: { owner, name: methodName, parameters: [...row[1]], result: row[2], signature, key: `${owner}->${methodName}${signature}` }, flags: row[3] };
}
export const hiddenFields = owner => REFLECT_FIELDS.has(owner) ? REFLECT_FIELDS.get(owner).map(row => reflectField(owner, row)) : entry(owner) ? [...entry(owner).fields.values()].map(row => ({ field: { owner, name: row[0], type: row[1], key: key(owner, row[0], row[1]) }, flags: row[2] })) : [];
export const hiddenMethods = (owner, wantConstructors) => (entry(owner)?.methods ?? []).filter(row => (row[0] === '<init>') === wantConstructors && row[0] !== '<clinit>').map(row => {
  const signature = `(${row[1].join('')})${row[2]}`;
  return { method: { owner, name: row[0], parameters: [...row[1]], result: row[2], signature, key: `${owner}->${row[0]}${signature}` }, flags: row[3] };
});

const WMG = 'Landroid/view/WindowManagerGlobal;', HANDLER = 'Landroid/os/Handler;', LOOPER = 'Landroid/os/Looper;', QUEUE = 'Landroid/os/MessageQueue;', MESSAGE = 'Landroid/os/Message;', THREAD = 'Landroid/app/ActivityThread;', H = 'Landroid/app/ActivityThread$H;';
const isNull = value => value === null || value === undefined || value === 0;
const same = (a, b) => !isNull(a) && !isNull(b) && a.ref === b.ref;
const mainLooper = rt => rt.platform.looperHost.mainLooper(rt);
const call = (rt, receiver, owner, name, result) => rt.dispatch({ owner, name, parameters: [], result, signature: `()${result}` }, [receiver], 'virtual');
export const activityThread = rt => rt.activityThread ??= rt.allocate(THREAD);
const mainHandler = rt => {
  if (rt.activityThreadHandler) return rt.activityThreadHandler;
  const handler = rt.allocate(H); rt.dispatch({ owner: HANDLER, name: '<init>', parameters: [LOOPER], result: 'V', signature: `(${LOOPER})V` }, [handler, mainLooper(rt)], 'direct');   // ActivityThread.H is the main thread's Handler
  return rt.activityThreadHandler = handler;
};

/** Instance accessors by field key: { get(rt, receiver), set(rt, receiver, value) }. A field without an accessor is shadow storage. */
export const ACCESSORS = new Map([
  [key(THREAD, 'mH', H), { get: rt => mainHandler(rt) }],
  [key(THREAD, 'mLooper', LOOPER), { get: rt => mainLooper(rt) }],
  [key(THREAD, 'mActivities', 'Landroid/util/ArrayMap;'), { get: rt => rt.activityThreadActivities ??= (() => { const map = rt.allocate('Landroid/util/ArrayMap;'); rt.dispatch({ owner: 'Landroid/util/ArrayMap;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [map], 'direct'); return map; })() }],
  [key(THREAD, 'mInitialApplication', 'Landroid/app/Application;'), { get: rt => rt.platform.applicationAttached ? rt.platform.application : null }],
  [key('Landroid/content/ContextWrapper;', 'mBase', 'Landroid/content/Context;'), { get: (rt, o) => rt.object(o).baseContext ?? null, set: (rt, o, v) => { rt.object(o).baseContext = isNull(v) ? null : v; } }],
  [key('Landroid/app/Activity;', 'mApplication', 'Landroid/app/Application;'), { get: rt => rt.platform.application ?? null }],
  [key('Landroid/app/Activity;', 'mMainThread', THREAD), { get: rt => activityThread(rt) }],
  // the process's Instrumentation; an app may install its own (recorded at the next activity launch: the lab drives activities without calling Instrumentation)
  [key(THREAD, 'mInstrumentation', 'Landroid/app/Instrumentation;'), { get: rt => rt.instrumentation ??= (rt.defaultInstrumentation ??= rt.allocate('Landroid/app/Instrumentation;')), set: (rt, _o, v) => { rt.defaultInstrumentation ??= rt.allocate('Landroid/app/Instrumentation;'); rt.instrumentation = isNull(v) ? null : v; } }],
  [key('Landroid/app/Activity;', 'mDecor', 'Landroid/view/View;'), { get: (rt, o) => { const window = call(rt, o, 'Landroid/app/Activity;', 'getWindow', 'Landroid/view/Window;'); return isNull(window) ? null : call(rt, window, 'Landroid/view/Window;', 'peekDecorView', 'Landroid/view/View;'); } }],
  [key('Landroid/view/View;', 'mContext', 'Landroid/content/Context;'), { get: (rt, o) => call(rt, o, 'Landroid/view/View;', 'getContext', 'Landroid/content/Context;') }],
  // Executable.artMethod: on ART the ArtMethod* of the method, which is also its jmethodID in a non-debuggable app (FromReflectedMethod answers the same value): the ArtMethod
  // the lab lays out in the app's ARM64 native process (src/arm64/art-runtime.js), or the JNI bridge's jmethodID of the member when there is no such process.
  [key('Ljava/lang/reflect/Executable;', 'artMethod', 'J'), { get: (rt, o) => { const member = rt.object(o).member; if (!member?.method) throw new APKError('Executable.artMethod read on an object without a reflected method', { kind: 'internal' }); if (!rt.jni) throw new APKError('Executable.artMethod is the method\'s jmethodID, and this VM has no JNI bridge', { kind: 'jni-required' }); return BigInt(rt.jni.artMethodOf(member)); } }],
  // Field.accessFlags: the access flags of this Field object (getModifiers is their low 16 bits; Field.set refuses a final field from them). A write changes this Field object only, as on ART.
  [key('Ljava/lang/reflect/Field;', 'accessFlags', 'I'), { get: (rt, o) => rt.object(o).member?.flags ?? 0, set: (rt, o, v) => { const obj = rt.object(o); obj.member = { ...obj.member, flags: Number(v) | 0 }; } }],
  // AccessibleObject.override: the flag setAccessible(true) sets and the access checks of invoke / get / set skip on.
  [key('Ljava/lang/reflect/AccessibleObject;', 'override', 'Z'), { get: (rt, o) => rt.object(o).accessible ? 1 : 0, set: (rt, o, v) => { rt.object(o).accessible = !!Number(v); } }],
]);

/** Static fields: accessors by key, then the compile-time constants of the table; the rest is shadow storage in the runtime's static table (read: default of the type). */
const STATIC_ACCESSORS = new Map([
  [key(THREAD, 'sCurrentActivityThread', THREAD), rt => activityThread(rt)],
  // WindowManagerGlobal (src/window-manager-global.js): the singleton once getInstance() or a window created it; the IWindowManager from the first Activity launch on
  // (WindowManagerGlobal.initialize() in ActivityThread.handleLaunchActivity); no IWindowSession in the lab (null, as before a device's first window).
  [key(WMG, 'sDefaultWindowManager', WMG), rt => rt.hostWindowManagerGlobal ?? null],
  [key(WMG, 'sWindowManagerService', 'Landroid/view/IWindowManager;'), rt => rt.platform.allFrames?.().length ? rt.dispatch({ owner: WMG, name: 'getWindowManagerService', parameters: [], result: 'Landroid/view/IWindowManager;', signature: '()Landroid/view/IWindowManager;' }, [], 'static') : null],
]);
export function hiddenStatic(rt, field) {
  const table = entry(field.owner); if (!table) return { handled: false };
  const row = table.fields.get(field.name); if (!row || row[1] !== field.type) return { handled: false };
  const accessor = STATIC_ACCESSORS.get(field.key); if (accessor) return { handled: true, value: accessor(rt) };
  if (row.length > 3 && row[3] !== null && row[3] !== undefined) {
    const value = row[3]; return { handled: true, value: field.type === 'J' ? BigInt(value) : field.type === 'Z' ? (value ? 1 : 0) : value };
  }
  { const constant = constantField(field.owner, field.name); if (constant && constant.type === field.type) return { handled: true, value: constant.value }; }   // an SDK compile-time constant (Context.*_SERVICE): the value its class file carries
  return { handled: true, value: field.type === 'J' || field.type === 'D' ? 0n : field.type.startsWith('L') || field.type.startsWith('[') ? null : 0 };
}
