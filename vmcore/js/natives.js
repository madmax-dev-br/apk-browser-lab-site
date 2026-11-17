// The natives core.wasm runs in C (vmcore/natives.h, natives.c), by method key: the linker (vmcore/js/linker.js) gives a method whose key is here this native id as its kind,
// and every other method without DEX code METHOD_UNBOUND (calling it stops the run with UNBOUND_NATIVE: the host boundary's). The ids are natives.h's enum, in the same order.
//
// Host virtuals: java.lang.Object and java.lang.String are classes without DEX code (the lab's hosts implement them), so the linker gives their records the vtable slots of the
// instance methods the JavaScript VM bridges for them (src/apk-runtime.js addBridge lists): a virtual call then resolves as it does there, to the C native when there is one
// and to an unbound method otherwise, and a DEX class that overrides hashCode/equals/toString takes the slot of Object's.
const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
const ATOMIC = 'Ljava/util/concurrent/atomic/';
export const ATOMIC_INTEGER = `${ATOMIC}AtomicInteger;`, ATOMIC_REFERENCE = `${ATOMIC}AtomicReference;`, ATOMIC_LONG = `${ATOMIC}AtomicLong;`, ATOMIC_BOOLEAN = `${ATOMIC}AtomicBoolean;`,
  ATOMIC_ARRAY = `${ATOMIC}AtomicReferenceArray;`, UPDATER_REF = `${ATOMIC}AtomicReferenceFieldUpdater;`, UPDATER_INT = `${ATOMIC}AtomicIntegerFieldUpdater;`, UPDATER_LONG = `${ATOMIC}AtomicLongFieldUpdater;`;
export const NATIVE_KEYS = [
  null,
  'Ljava/lang/Float;->floatToIntBits(F)I', 'Ljava/lang/Double;->doubleToLongBits(D)J', `${OBJECT}-><init>()V`,
  `${STRING}->length()I`, `${STRING}->isEmpty()Z`, `${STRING}->charAt(I)C`, `${STRING}->equals(Ljava/lang/Object;)Z`, `${STRING}->hashCode()I`, `${STRING}->compareTo(Ljava/lang/String;)I`,
  `${STRING}->compareTo(Ljava/lang/Object;)I`, `${STRING}->indexOf(I)I`, `${STRING}->substring(I)Ljava/lang/String;`, `${STRING}->substring(II)Ljava/lang/String;`,
  `${STRING}->concat(Ljava/lang/String;)Ljava/lang/String;`, `${STRING}->startsWith(Ljava/lang/String;)Z`, `${STRING}->endsWith(Ljava/lang/String;)Z`,
  `${OBJECT}->hashCode()I`, `${OBJECT}->equals(Ljava/lang/Object;)Z`, 'Ljava/lang/System;->arraycopy(Ljava/lang/Object;ILjava/lang/Object;II)V',
  'Ljava/lang/Math;->min(II)I', 'Ljava/lang/Math;->max(II)I', 'Ljava/lang/Math;->abs(I)I', 'Ljava/lang/Math;->min(JJ)J', 'Ljava/lang/Math;->max(JJ)J', 'Ljava/lang/Math;->abs(J)J',
  'Ljava/lang/Math;->min(FF)F', 'Ljava/lang/Math;->max(FF)F', 'Ljava/lang/Math;->abs(F)F', 'Ljava/lang/Math;->min(DD)D', 'Ljava/lang/Math;->max(DD)D', 'Ljava/lang/Math;->abs(D)D',
  'Ljava/lang/Integer;->bitCount(I)I', 'Ljava/lang/Integer;->rotateLeft(II)I', 'Ljava/lang/Integer;->rotateRight(II)I', 'Ljava/lang/Integer;->numberOfLeadingZeros(I)I',
  'Ljava/lang/Integer;->numberOfTrailingZeros(I)I',
  'Ljava/lang/Long;->bitCount(J)I', 'Ljava/lang/Long;->rotateLeft(JI)J', 'Ljava/lang/Long;->rotateRight(JI)J', 'Ljava/lang/Long;->numberOfLeadingZeros(J)I',
  'Ljava/lang/Long;->numberOfTrailingZeros(J)I',
  'Ljava/lang/Float;->floatToRawIntBits(F)I', 'Ljava/lang/Float;->intBitsToFloat(I)F', 'Ljava/lang/Double;->doubleToRawLongBits(D)J', 'Ljava/lang/Double;->longBitsToDouble(J)D',
  `${OBJECT}->getClass()Ljava/lang/Class;`,
  `${STRING}-><init>()V`, `${STRING}-><init>(Ljava/lang/String;)V`, `${STRING}-><init>([C)V`, `${STRING}-><init>([CII)V`,   // classes.h: they answer the new String
  // natives bound by the bridge the JavaScript VM selects (BRIDGE_NATIVES below), not by method key: no entry here
  null, null, null, null, null, null, null, null, null, null, null, null,
  `${OBJECT}->notify()V`, `${OBJECT}->notifyAll()V`, `${OBJECT}->wait()V`, `${OBJECT}->wait(J)V`, `${OBJECT}->wait(JI)V`,   // vmcore/threads.c
  // pure statics a Compose frame calls hundreds of times (each a host crossing before): the bridge chunk's answers
  'Ljava/lang/Float;->isNaN(F)Z', 'Ljava/lang/Float;->isInfinite(F)Z', 'Ljava/lang/Float;->isFinite(F)Z', 'Ljava/lang/Double;->isNaN(D)Z', 'Ljava/lang/Double;->isInfinite(D)Z',
  'Ljava/lang/Double;->isFinite(D)Z', 'Ljava/lang/Math;->round(F)I', 'Ljava/lang/Integer;->hashCode(I)I',
  // bound by bridge (BRIDGE_NATIVES): Thread.currentThread / Thread.getId over the thread identity of HostState, Class.isInstance / Class.getComponentType (classes.c)
  null, null, null, null,
  null,   // bound by bridge: AtomicReference.get over its reference payload
  'Ljava/lang/Float;->compare(FF)I', 'Ljava/lang/Double;->compare(DD)I',   // pure statics a Compose frame calls about 150 times
  // leaf natives bound by the bridge (BRIDGE_NATIVES below, from LEAF_FIRST): the atomics
  ...Array(50).fill(null),
  // the atomics' constructors, bound by key (natives.c): AtomicInteger, AtomicBoolean, AtomicLong, AtomicReference
  `${ATOMIC_INTEGER}-><init>()V`, `${ATOMIC_INTEGER}-><init>(I)V`, `${ATOMIC_BOOLEAN}-><init>()V`, `${ATOMIC_BOOLEAN}-><init>(Z)V`, `${ATOMIC_LONG}-><init>()V`, `${ATOMIC_LONG}-><init>(J)V`,
  `${ATOMIC_REFERENCE}-><init>()V`, `${ATOMIC_REFERENCE}-><init>(Ljava/lang/Object;)V`,
  // bound by the bridge (OBJECT_FIRST): System.identityHashCode, Boolean.valueOf(Z), Enum.ordinal, name / toString, compareTo
  null, null, null, null, null,
  'Ljava/lang/Enum;-><init>(Ljava/lang/String;I)V',
  // bound by the bridge (ARRAYS_FIRST): Arrays.fill, fill of a range, fill of a boolean[], of a range of one, copyOf, copyOfRange
  null, null, null, null, null, null,
  'Ljava/lang/reflect/Array;->newInstance(Ljava/lang/Class;I)Ljava/lang/Object;', 'Ljava/lang/reflect/Array;->getLength(Ljava/lang/Object;)I',
  // pure statics (natives.c): floorDiv / floorMod of int and long, ceil, floor, sqrt, rint, round(double), toRadians, toDegrees, Integer.lowestOneBit / highestOneBit
  'Ljava/lang/Math;->floorDiv(II)I', 'Ljava/lang/Math;->floorMod(II)I', 'Ljava/lang/Math;->floorDiv(JJ)J', 'Ljava/lang/Math;->floorMod(JJ)J', 'Ljava/lang/Math;->ceil(D)D',
  'Ljava/lang/Math;->floor(D)D', 'Ljava/lang/Math;->sqrt(D)D', 'Ljava/lang/Math;->rint(D)D', 'Ljava/lang/Math;->round(D)J', 'Ljava/lang/Math;->toRadians(D)D',
  'Ljava/lang/Math;->toDegrees(D)D', 'Ljava/lang/Integer;->lowestOneBit(I)I', 'Ljava/lang/Integer;->highestOneBit(I)I',
  // bound by the bridge (THREAD_LOCAL_FIRST): ThreadLocal.get and set
  null, null,
  // bound by bridge (BRIDGE_NATIVES): android.graphics.Canvas's save stack and translate, Paint's fields in memory (vmcore/graphics.h, GRAPHICS_NATIVES below)
  null, null, null, null, null,
  null, null, null, null, null, null, null, null, null, null,
];
const BRIDGE_FIRST = NATIVE_KEYS.indexOf(`${STRING}-><init>([CII)V`) + 1;   // natives.h NATIVE_BOX_VALUE_OF_B
const IDENTITY_FIRST = NATIVE_KEYS.indexOf('Ljava/lang/Integer;->hashCode(I)I') + 1;   // natives.h NATIVE_THREAD_CURRENT
const OBJECT_FIRST = NATIVE_KEYS.indexOf(`${ATOMIC_REFERENCE}-><init>(Ljava/lang/Object;)V`) + 1;   // natives.h NATIVE_IDENTITY_HASH_CODE
const ARRAYS_FIRST = NATIVE_KEYS.indexOf('Ljava/lang/Enum;-><init>(Ljava/lang/String;I)V') + 1;   // natives.h NATIVE_ARRAYS_FILL
const THREAD_LOCAL_FIRST = NATIVE_KEYS.indexOf('Ljava/lang/Integer;->highestOneBit(I)I') + 1;   // natives.h NATIVE_THREAD_LOCAL_GET
const LEAF_FIRST = NATIVE_KEYS.indexOf('Ljava/lang/Double;->compare(DD)I') + 1;   // natives.h NATIVE_ATOMIC_INTEGER_SET
export const THREAD_LOCAL = 'Ljava/lang/ThreadLocal;', THREAD_LOCAL_GET_KEY = 'Ljava/lang/ThreadLocal;->get()Ljava/lang/Object;', THREAD_LOCAL_SET_KEY = 'Ljava/lang/ThreadLocal;->set(Ljava/lang/Object;)V',
  THREAD_LOCAL_REMOVE_KEY = 'Ljava/lang/ThreadLocal;->remove()V';
export const ARRAY_NEW_INSTANCE_KEY = 'Ljava/lang/reflect/Array;->newInstance(Ljava/lang/Class;I)Ljava/lang/Object;', ENUM = 'Ljava/lang/Enum;', IDENTITY_HASH_KEY = 'Ljava/lang/System;->identityHashCode(Ljava/lang/Object;)I', BOOLEAN_VALUE_OF_KEY = 'Ljava/lang/Boolean;->valueOf(Z)Ljava/lang/Boolean;';
const GRAPHICS_FIRST = THREAD_LOCAL_FIRST + 2;   // natives.h NATIVE_CANVAS_TRANSLATE: right after NATIVE_THREAD_LOCAL_SET
export const CANVAS = 'Landroid/graphics/Canvas;', PAINT = 'Landroid/graphics/Paint;';
/**
 * The graphics natives (vmcore/graphics.h) by group, in natives.h's order: the host class whose bridges they reproduce and the methods (name + signature). A class below the host
 * class gets the group's Class flag only when its DEX code declares none of these methods (vmcore/js/host-linking.js), and the natives answer only for such receivers.
 */
export const GRAPHICS_NATIVES = [
  { owner: CANVAS, flag: 1 << 16, methods: ['translate(FF)V', 'save()I', 'restore()V', 'restoreToCount(I)V', 'getSaveCount()I'] },
  { owner: PAINT, flag: 1 << 17, methods: ['getNativeInstance()J', 'setColor(I)V', 'getColor()I', 'getAlpha()I', 'setAlpha(I)V', 'isFilterBitmap()Z', 'getStartHyphenEdit()I',
    'getEndHyphenEdit()I', 'setStartHyphenEdit(I)V', 'setEndHyphenEdit(I)V'] },
];
export const THREAD = 'Ljava/lang/Thread;', CURRENT_THREAD_KEY = `${THREAD}->currentThread()${THREAD}`, THREAD_GET_ID_KEY = `${THREAD}->getId()J`;
/** The java.lang box classes by kind (natives.h BOX_*: Z B S C I J F D). */
export const BOX_CLASSES = ['Ljava/lang/Boolean;', 'Ljava/lang/Byte;', 'Ljava/lang/Short;', 'Ljava/lang/Character;', 'Ljava/lang/Integer;', 'Ljava/lang/Long;', 'Ljava/lang/Float;', 'Ljava/lang/Double;'];
export const BOX_LETTERS = 'ZBSCIJFD';
/**
 * Natives bound through the host trampoline (vmcore/js/host-bridge.js): when the JavaScript VM's routing selects the bridge of key K for a call the core made through a host
 * record, and K is here, that record's kind becomes the native, so the next calls run in C with that bridge's semantics (natives.h). `anyReceiver`: the native answers for a
 * receiver of any class (Object.getClass); otherwise the record must serve receivers of one final class only (the box classes are final). Each entry is the bridge body it
 * reproduces (src/apk-runtime.js): boxPrimitive for valueOf, `obj.boxed` for xxxValue of the box's own kind, boxedHash, boxedEquals, classObject(typeOf(receiver)).
 */
export const BRIDGE_NATIVES = new Map([
  ...['B', 'S', 'C', 'I', 'J', 'F', 'D'].map((type, i) => [`${BOX_CLASSES[BOX_LETTERS.indexOf(type)]}->valueOf(${type})${BOX_CLASSES[BOX_LETTERS.indexOf(type)]}`, { id: BRIDGE_FIRST + i }]),
  ...[['Z', 'booleanValue'], ['B', 'byteValue'], ['S', 'shortValue'], ['C', 'charValue'], ['I', 'intValue'], ['J', 'longValue'], ['F', 'floatValue'], ['D', 'doubleValue']]
    .map(([type, name]) => [`${BOX_CLASSES[BOX_LETTERS.indexOf(type)]}->${name}()${type}`, { id: BRIDGE_FIRST + 7 }]),
  ...BOX_CLASSES.map(owner => [`${owner}->hashCode()I`, { id: BRIDGE_FIRST + 8 }]),
  ...BOX_CLASSES.map(owner => [`${owner}->equals(Ljava/lang/Object;)Z`, { id: BRIDGE_FIRST + 9 }]),
  [`${OBJECT}->getClass()Ljava/lang/Class;`, { id: NATIVE_KEYS.indexOf(`${OBJECT}->getClass()Ljava/lang/Class;`), anyReceiver: true }],   // NATIVE_OBJECT_GET_CLASS: the receiver's class's Class object, the one classObject(type) answers
  // DIRECT_BRIDGES' AtomicInteger.get and compareAndSet over `atomicValue`; the natives check the receiver's class themselves (a subclass defers to the bridge)
  [`${ATOMIC_INTEGER}->get()I`, { id: BRIDGE_FIRST + 10, anyReceiver: true }], [`${ATOMIC_INTEGER}->compareAndSet(II)Z`, { id: BRIDGE_FIRST + 11, anyReceiver: true }],
  // the thread identity the bridges last answered (natives.h HostState, filled and cleared by host-bridge.js); getId answers only for the current thread's own object
  [CURRENT_THREAD_KEY, { id: IDENTITY_FIRST }], [THREAD_GET_ID_KEY, { id: IDENTITY_FIRST + 1, anyReceiver: true }],
  // the Class bridges' isInstance and getComponentType over the receiver's Class record (java.lang.Class is final: every receiver is a Class object)
  ['Ljava/lang/Class;->isInstance(Ljava/lang/Object;)Z', { id: IDENTITY_FIRST + 2, anyReceiver: true }], ['Ljava/lang/Class;->getComponentType()Ljava/lang/Class;', { id: IDENTITY_FIRST + 3, anyReceiver: true }],
  // the atomics bridge's AtomicReference.get over `atomicValue`, a reference payload (host-linking.js); the native checks the receiver's class itself
  [`${ATOMIC_REFERENCE}->get()Ljava/lang/Object;`, { id: IDENTITY_FIRST + 4, anyReceiver: true }],
  ...leafEntries(),
  // Object identity of the receivers of host classes (a Class object, a host object) the JavaScript VM serves with Object's own methods; the hash is the record's address / 8
  // (host-bridge.js makes the bridge answer the same). System.identityHashCode, Boolean.valueOf(boolean) (the Boolean.TRUE / FALSE records the bridge told HostState), java.lang.Enum
  [`${OBJECT}->hashCode()I`, { id: NATIVE_KEYS.indexOf(`${OBJECT}->hashCode()I`), anyReceiver: true }], [`${OBJECT}->equals(Ljava/lang/Object;)Z`, { id: NATIVE_KEYS.indexOf(`${OBJECT}->equals(Ljava/lang/Object;)Z`), anyReceiver: true }],
  ['Ljava/lang/System;->identityHashCode(Ljava/lang/Object;)I', { id: OBJECT_FIRST }], ['Ljava/lang/Boolean;->valueOf(Z)Ljava/lang/Boolean;', { id: OBJECT_FIRST + 1 }],
  ['Ljava/lang/Enum;->ordinal()I', { id: OBJECT_FIRST + 2, anyReceiver: true }], ['Ljava/lang/Enum;->name()Ljava/lang/String;', { id: OBJECT_FIRST + 3, anyReceiver: true }],
  ['Ljava/lang/Enum;->toString()Ljava/lang/String;', { id: OBJECT_FIRST + 3, anyReceiver: true }], ['Ljava/lang/Enum;->compareTo(Ljava/lang/Enum;)I', { id: OBJECT_FIRST + 4, anyReceiver: true }],
  ['Ljava/lang/Enum;->compareTo(Ljava/lang/Object;)I', { id: OBJECT_FIRST + 4, anyReceiver: true }],
  ...arraysEntries(),
  [`${THREAD_LOCAL}->get()Ljava/lang/Object;`, { id: THREAD_LOCAL_FIRST, anyReceiver: true }], [`${THREAD_LOCAL}->set(Ljava/lang/Object;)V`, { id: THREAD_LOCAL_FIRST + 1, anyReceiver: true }],
  // Canvas's and Paint's own bridges (src/vector-native.js, src/skia-canvas-host.js, src/paint-host.js); the natives check the receiver's class flag themselves (graphics.h)
  ...GRAPHICS_NATIVES.flatMap(group => group.methods.map(method => `${group.owner}->${method}`)).map((key, i) => [key, { id: GRAPHICS_FIRST + i, anyReceiver: true }]),
]);
/**
 * The atomics' bridge keys (src/apk-runtime.js addBridge lists) and the C native of each (natives.h, LEAF_FIRST on: one id per operation, shared by the weak and lazy forms and,
 * for an AtomicBoolean, by the AtomicInteger's, whose payload it shares). All answer any receiver: the natives check the receiver's class themselves and defer to the bridge.
 */
function leafEntries() {
  const entries = [], at = n => ({ id: LEAF_FIRST + n, anyReceiver: true }), add = (owner, signature, entry) => entries.push([`${owner}->${signature}`, entry]);
  const GET = { id: BRIDGE_FIRST + 10, anyReceiver: true }, CAS = { id: BRIDGE_FIRST + 11, anyReceiver: true };
  // AtomicInteger (I) and AtomicBoolean (Z): NATIVE_ATOMIC_INTEGER_SET ... _DEC_AND_GET are LEAF_FIRST + 0..7
  for (const [owner, type] of [[ATOMIC_INTEGER, 'I'], [ATOMIC_BOOLEAN, 'Z']]) {
    add(owner, `get()${type}`, GET); add(owner, `set(${type})V`, at(0)); add(owner, `lazySet(${type})V`, at(0)); add(owner, `getAndSet(${type})${type}`, at(1));
    add(owner, `compareAndSet(${type}${type})Z`, CAS); add(owner, `weakCompareAndSet(${type}${type})Z`, CAS);
  }
  [['getAndAdd(I)I', 2], ['addAndGet(I)I', 3], ['getAndIncrement()I', 4], ['incrementAndGet()I', 5], ['getAndDecrement()I', 6], ['decrementAndGet()I', 7], ['intValue()I', null]]
    .forEach(([signature, n]) => add(ATOMIC_INTEGER, signature, n === null ? GET : at(n)));
  // AtomicLong: LEAF_FIRST + 8..17
  [['get()J', 8], ['set(J)V', 9], ['lazySet(J)V', 9], ['getAndSet(J)J', 10], ['compareAndSet(JJ)Z', 11], ['weakCompareAndSet(JJ)Z', 11], ['getAndAdd(J)J', 12], ['addAndGet(J)J', 13],
    ['getAndIncrement()J', 14], ['incrementAndGet()J', 15], ['getAndDecrement()J', 16], ['decrementAndGet()J', 17]].forEach(([signature, n]) => add(ATOMIC_LONG, signature, at(n)));
  // AtomicReference: set / getAndSet / compareAndSet (get is IDENTITY_FIRST + 4); LEAF_FIRST + 18..20
  const OBJECT_TYPE = 'Ljava/lang/Object;';
  [[`set(${OBJECT_TYPE})V`, 18], [`lazySet(${OBJECT_TYPE})V`, 18], [`getAndSet(${OBJECT_TYPE})${OBJECT_TYPE}`, 19], [`compareAndSet(${OBJECT_TYPE}${OBJECT_TYPE})Z`, 20],
    [`weakCompareAndSet(${OBJECT_TYPE}${OBJECT_TYPE})Z`, 20]].forEach(([signature, n]) => add(ATOMIC_REFERENCE, signature, at(n)));
  // AtomicReferenceArray: LEAF_FIRST + 21..25
  [['length()I', 21], ['get(I)Ljava/lang/Object;', 22], ['set(ILjava/lang/Object;)V', 23], ['lazySet(ILjava/lang/Object;)V', 23], ['getAndSet(ILjava/lang/Object;)Ljava/lang/Object;', 24],
    ['compareAndSet(ILjava/lang/Object;Ljava/lang/Object;)Z', 25], ['weakCompareAndSet(ILjava/lang/Object;Ljava/lang/Object;)Z', 25]].forEach(([signature, n]) => add(ATOMIC_ARRAY, signature, at(n)));
  // field updaters: reference LEAF_FIRST + 26..29, integer 30..39, long 40..49
  const O = 'Ljava/lang/Object;';
  [[`get(${O})${O}`, 26], [`set(${O}${O})V`, 27], [`lazySet(${O}${O})V`, 27], [`getAndSet(${O}${O})${O}`, 28], [`compareAndSet(${O}${O}${O})Z`, 29], [`weakCompareAndSet(${O}${O}${O})Z`, 29]]
    .forEach(([signature, n]) => add(UPDATER_REF, signature, at(n)));
  for (const [owner, type, first] of [[UPDATER_INT, 'I', 30], [UPDATER_LONG, 'J', 40]]) {
    [[`get(${O})${type}`, 0], [`set(${O}${type})V`, 1], [`lazySet(${O}${type})V`, 1], [`getAndSet(${O}${type})${type}`, 2], [`compareAndSet(${O}${type}${type})Z`, 3], [`weakCompareAndSet(${O}${type}${type})Z`, 3],
      [`getAndAdd(${O}${type})${type}`, 4], [`addAndGet(${O}${type})${type}`, 5], [`getAndIncrement(${O})${type}`, 6], [`incrementAndGet(${O})${type}`, 7], [`getAndDecrement(${O})${type}`, 8],
      [`decrementAndGet(${O})${type}`, 9]].forEach(([signature, n]) => add(owner, signature, at(first + n)));
  }
  return entries;
}
/** java.util.Arrays' fill / copyOf / copyOfRange of every array type (the bridge's keys, src/apk-runtime.js addBridge): static calls of a class whose DEX lacks the methods. */
function arraysEntries() {
  const ARRAYS = 'Ljava/util/Arrays;', entries = [];
  for (const c of ['Z', 'B', 'S', 'C', 'I', 'J', 'F', 'D', 'Ljava/lang/Object;']) {
    entries.push([`${ARRAYS}->fill([${c}${c})V`, { id: ARRAYS_FIRST + (c === 'Z' ? 2 : 0) }], [`${ARRAYS}->fill([${c}II${c})V`, { id: ARRAYS_FIRST + (c === 'Z' ? 3 : 1) }],
      [`${ARRAYS}->copyOf([${c}I)[${c}`, { id: ARRAYS_FIRST + 4 }], [`${ARRAYS}->copyOfRange([${c}II)[${c}`, { id: ARRAYS_FIRST + 5 }]);
  }
  return entries;
}
/** The String constructors the core serves (the linker rewrites calls of them to INVOKE_STRING_INIT, classes.h). */
export const STRING_CONSTRUCTORS = new Set(NATIVE_KEYS.filter(key => key?.startsWith(`${STRING}-><init>`)));
/** Method key -> native id: every C native. */
export const CORE_NATIVES = new Map(NATIVE_KEYS.flatMap((key, id) => key ? [[key, id]] : []));
export const NATIVE_COUNT = NATIVE_KEYS.length;

/** Instance methods (name + signature) a host class's record gets vtable slots for, in this order after its superclass's. */
export const HOST_VIRTUALS = new Map([
  [OBJECT, ['getClass()Ljava/lang/Class;', 'hashCode()I', 'equals(Ljava/lang/Object;)Z', 'toString()Ljava/lang/String;', 'clone()Ljava/lang/Object;', 'finalize()V',
    'notify()V', 'notifyAll()V', 'wait()V', 'wait(J)V', 'wait(JI)V']],
  [STRING, ['length()I', 'isEmpty()Z', 'charAt(I)C', 'equals(Ljava/lang/Object;)Z', 'hashCode()I', 'toString()Ljava/lang/String;', 'compareTo(Ljava/lang/String;)I',
    'compareTo(Ljava/lang/Object;)I', 'indexOf(I)I', 'indexOf(II)I', 'indexOf(Ljava/lang/String;)I', 'indexOf(Ljava/lang/String;I)I', 'lastIndexOf(I)I', 'lastIndexOf(II)I',
    'lastIndexOf(Ljava/lang/String;)I', 'lastIndexOf(Ljava/lang/String;I)I', 'substring(I)Ljava/lang/String;', 'substring(II)Ljava/lang/String;',
    'subSequence(II)Ljava/lang/CharSequence;', 'concat(Ljava/lang/String;)Ljava/lang/String;', 'startsWith(Ljava/lang/String;)Z', 'startsWith(Ljava/lang/String;I)Z',
    'endsWith(Ljava/lang/String;)Z', 'trim()Ljava/lang/String;', 'contains(Ljava/lang/CharSequence;)Z', 'equalsIgnoreCase(Ljava/lang/String;)Z',
    'compareToIgnoreCase(Ljava/lang/String;)I', 'codePointAt(I)I', 'codePointBefore(I)I', 'codePointCount(II)I', 'offsetByCodePoints(II)I', 'intern()Ljava/lang/String;',
    'repeat(I)Ljava/lang/String;', 'isBlank()Z', 'contentEquals(Ljava/lang/CharSequence;)Z', 'toLowerCase()Ljava/lang/String;', 'toUpperCase()Ljava/lang/String;',
    'toLowerCase(Ljava/util/Locale;)Ljava/lang/String;', 'toUpperCase(Ljava/util/Locale;)Ljava/lang/String;', 'regionMatches(ILjava/lang/String;II)Z',
    'regionMatches(ZILjava/lang/String;II)Z', 'getBytes()[B', 'getBytes(Ljava/lang/String;)[B', 'getBytes(Ljava/nio/charset/Charset;)[B', 'getChars(II[CI)V', 'toCharArray()[C',
    'split(Ljava/lang/String;)[Ljava/lang/String;', 'split(Ljava/lang/String;I)[Ljava/lang/String;', 'replace(CC)Ljava/lang/String;',
    'replace(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Ljava/lang/String;']],
]);

/**
 * Interfaces without DEX code (APKRuntime.isInterfaceType): the methods the linker gives them as itable columns, in this order, so that invoke-interface on them selects the
 * receiver class's method as the JavaScript VM does (by name and signature). An interface not listed here has no methods in the core.
 */
export const HOST_INTERFACE_METHODS = new Map([
  ['Ljava/lang/Comparable;', ['compareTo(Ljava/lang/Object;)I']],
]);
