// The natives core.wasm runs in C (vmcore/natives.h, natives.c), by method key: the linker (vmcore/js/linker.js) gives a method whose key is here this native id as its kind,
// and every other method without DEX code METHOD_UNBOUND (calling it stops the run with UNBOUND_NATIVE: the host boundary's). The ids are natives.h's enum, in the same order.
//
// Host virtuals: java.lang.Object and java.lang.String are classes without DEX code (the lab's hosts implement them), so the linker gives their records the vtable slots of the
// instance methods the JavaScript VM bridges for them (src/apk-runtime.js addBridge lists): a virtual call then resolves as it does there, to the C native when there is one
// and to an unbound method otherwise, and a DEX class that overrides hashCode/equals/toString takes the slot of Object's.
const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
export const ATOMIC_INTEGER = 'Ljava/util/concurrent/atomic/AtomicInteger;', ATOMIC_REFERENCE = 'Ljava/util/concurrent/atomic/AtomicReference;';
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
  // bound by bridge (BRIDGE_NATIVES): android.graphics.Paint's state in the record (vmcore/paint.h, PAINT_NATIVES below): slice 1, then slice 2
  null, null, null, null, null, null, null, null, null, null, null, null,
  ...new Array(34).fill(null),
  null, null, null, null,   // bound by bridge (BRIDGE_NATIVES, UPDATER_FIRST): AtomicReferenceFieldUpdater get, set (and lazySet), getAndSet, compareAndSet (and weakCompareAndSet) over the updater payload (atomics.c)
  ...new Array(20).fill(null),   // the same for AtomicIntegerFieldUpdater and AtomicLongFieldUpdater (UPDATER_OPERATIONS)
  ...new Array(5).fill(null),    // AtomicReferenceArray: length, get, set (lazySet), getAndSet, compareAndSet (weakCompareAndSet) over the array payload (ARRAY_FIRST)
  ...new Array(29).fill(null),   // AtomicInteger, AtomicLong, AtomicBoolean, AtomicReference over their payloads (ATOMICS_FIRST, ATOMIC_OPERATIONS)
  null,   // bound by bridge: Boolean.valueOf(boolean) over HostState.booleanBox (BOOLEAN_VALUE_OF)
];
const BRIDGE_FIRST = NATIVE_KEYS.indexOf(`${STRING}-><init>([CII)V`) + 1;   // natives.h NATIVE_BOX_VALUE_OF_B
const IDENTITY_FIRST = NATIVE_KEYS.indexOf('Ljava/lang/Integer;->hashCode(I)I') + 1;   // natives.h NATIVE_THREAD_CURRENT
const PAINT_FIRST = NATIVE_KEYS.indexOf('Ljava/lang/Double;->compare(DD)I') + 1;   // natives.h NATIVE_PAINT_GET_NATIVE_INSTANCE
export const PAINT = 'Landroid/graphics/Paint;';
export const ATOMIC_REFERENCE_ARRAY = 'Ljava/util/concurrent/atomic/AtomicReferenceArray;';
export const ATOMIC_LONG = 'Ljava/util/concurrent/atomic/AtomicLong;', ATOMIC_BOOLEAN = 'Ljava/util/concurrent/atomic/AtomicBoolean;';
export const ARFU = 'Ljava/util/concurrent/atomic/AtomicReferenceFieldUpdater;', AIFU = 'Ljava/util/concurrent/atomic/AtomicIntegerFieldUpdater;', ALFU = 'Ljava/util/concurrent/atomic/AtomicLongFieldUpdater;';
/** The field updater classes laid out with the updater payload, by their index in natives.h HostState.updaterClass (UPD_REFERENCE, UPD_INTEGER, UPD_LONG). */
export const UPDATER_CLASSES = new Map([[ARFU, 0], [AIFU, 1], [ALFU, 2]]);
/** The operations of the int and long updaters in natives.h order (NATIVE_AIFU_GET ..): their bridge names (one native answers both of a pair), the parameters after the target and the result, T being the value type. */
const UPDATER_OPERATIONS = [[['get'], '', 'T'], [['set', 'lazySet'], 'T', 'V'], [['getAndSet'], 'T', 'T'], [['compareAndSet', 'weakCompareAndSet'], 'TT', 'Z'], [['getAndIncrement'], '', 'T'],
  [['getAndDecrement'], '', 'T'], [['incrementAndGet'], '', 'T'], [['decrementAndGet'], '', 'T'], [['getAndAdd'], 'T', 'T'], [['addAndGet'], 'T', 'T']];
/**
 * The paint natives (vmcore/paint.h), in natives.h's order: the paint host's methods (name + signature) they answer from the Paint record. A DEX class below Paint gets the
 * record's Class flag only when neither it nor a superclass declares one of these (vmcore/js/host-linking.js), and the natives answer only for receivers with the flag.
 */
export const PAINT_NATIVES = ['getNativeInstance()J', 'setColor(I)V', 'getColor()I', 'getAlpha()I', 'setAlpha(I)V', 'getFlags()I', 'setFlags(I)V', 'isFilterBitmap()Z',
  'getStartHyphenEdit()I', 'getEndHyphenEdit()I', 'setStartHyphenEdit(I)V', 'setEndHyphenEdit(I)V',
  // slice 2: Paint.set, the references, the floats, the enums, hinting and the text flags (natives.h NATIVE_PAINT_SET ..)
  `set(${PAINT})V`, 'setShader(Landroid/graphics/Shader;)Landroid/graphics/Shader;', 'getShader()Landroid/graphics/Shader;',
  'setColorFilter(Landroid/graphics/ColorFilter;)Landroid/graphics/ColorFilter;', 'getColorFilter()Landroid/graphics/ColorFilter;', 'getXfermode()Landroid/graphics/Xfermode;',
  'getMaskFilter()Landroid/graphics/MaskFilter;', 'getTypeface()Landroid/graphics/Typeface;', 'getTextLocales()Landroid/os/LocaleList;',
  'getStrokeWidth()F', 'setStrokeWidth(F)V', 'getStrokeMiter()F', 'getTextSize()F', 'setTextSize(F)V', 'getTextScaleX()F', 'getTextSkewX()F', 'getLetterSpacing()F',
  'setLetterSpacing(F)V', 'getWordSpacing()F', 'getStyle()Landroid/graphics/Paint$Style;', 'setStyle(Landroid/graphics/Paint$Style;)V', 'getStrokeCap()Landroid/graphics/Paint$Cap;',
  'getStrokeJoin()Landroid/graphics/Paint$Join;', 'getTextAlign()Landroid/graphics/Paint$Align;', 'getHinting()I', 'setHinting(I)V', 'isElegantTextHeight()Z',
  'isAntiAlias()Z', 'setAntiAlias(Z)V', 'setDither(Z)V', 'isUnderlineText()Z', 'setUnderlineText(Z)V', 'isStrikeThruText()Z', 'setStrikeThruText(Z)V'];
const UPDATER_FIRST = PAINT_FIRST + PAINT_NATIVES.length;   // natives.h NATIVE_ARFU_GET
const ARRAY_FIRST = UPDATER_FIRST + 24;   // natives.h NATIVE_ARRA_LENGTH
const ATOMICS_FIRST = ARRAY_FIRST + 5;   // natives.h NATIVE_ATOMIC_INTEGER_SET

/**
 * The operations of AtomicInteger, AtomicLong, AtomicBoolean and AtomicReference after the ones that had natives (get and compareAndSet of AtomicInteger, get of AtomicReference), in
 * natives.h order: [owner, value type, [bridge names of one native], parameters, result]; T is the value type. `weakCompareAndSet` and `lazySet` are answered by compareAndSet's and set's.
 */
const ATOMIC_OPERATIONS = (() => {
  const numeric = (owner, type) => [[['getAndIncrement'], '', 'T'], [['getAndDecrement'], '', 'T'], [['incrementAndGet'], '', 'T'], [['decrementAndGet'], '', 'T'], [['getAndAdd'], 'T', 'T'], [['addAndGet'], 'T', 'T'],
    [['intValue'], '', 'I'], [['longValue'], '', 'J']].map(op => [owner, type, ...op]);
  const basic = (owner, type, names) => names.map(name => [owner, type, ...({ get: [['get'], '', 'T'], set: [['set', 'lazySet'], 'T', 'V'], getAndSet: [['getAndSet'], 'T', 'T'], cas: [['compareAndSet', 'weakCompareAndSet'], 'TT', 'Z'] })[name]]);
  return [...basic(ATOMIC_INTEGER, 'I', ['set', 'getAndSet']), ...numeric(ATOMIC_INTEGER, 'I'),
    ...basic(ATOMIC_LONG, 'J', ['get', 'set', 'getAndSet', 'cas']), ...numeric(ATOMIC_LONG, 'J'),
    ...basic(ATOMIC_BOOLEAN, 'Z', ['get', 'set', 'getAndSet', 'cas']),
    ...basic(ATOMIC_REFERENCE, 'Ljava/lang/Object;', ['set', 'getAndSet', 'cas'])];
})();
const BOOLEAN_VALUE_OF = ATOMICS_FIRST + ATOMIC_OPERATIONS.length;   // natives.h NATIVE_BOOLEAN_VALUE_OF
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
  // the field updaters' bridges (DIRECT_BRIDGES' get and compareAndSet, bridgeB's FieldUpdater branch) over the updater payload (host-linking.js, atomics.c); the natives check the receiver's class and the target themselves
  [`${ARFU}->get(Ljava/lang/Object;)Ljava/lang/Object;`, { id: UPDATER_FIRST, anyReceiver: true }],
  [`${ARFU}->set(Ljava/lang/Object;Ljava/lang/Object;)V`, { id: UPDATER_FIRST + 1, anyReceiver: true }], [`${ARFU}->lazySet(Ljava/lang/Object;Ljava/lang/Object;)V`, { id: UPDATER_FIRST + 1, anyReceiver: true }],
  [`${ARFU}->getAndSet(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;`, { id: UPDATER_FIRST + 2, anyReceiver: true }],
  [`${ARFU}->compareAndSet(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)Z`, { id: UPDATER_FIRST + 3, anyReceiver: true }],
  [`${ARFU}->weakCompareAndSet(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Object;)Z`, { id: UPDATER_FIRST + 3, anyReceiver: true }],
  ...[[AIFU, 'I'], [ALFU, 'J']].flatMap(([owner, type], kind) => UPDATER_OPERATIONS.flatMap(([names, params, result], op) => names.map(name =>
    [`${owner}->${name}(Ljava/lang/Object;${params.replaceAll('T', type)})${result.replace('T', type)}`, { id: UPDATER_FIRST + 4 + 10 * kind + op, anyReceiver: true }]))),
  // AtomicReferenceArray over `atomicArray`, a reference payload (host-linking.js, atomics.c)
  [`${ATOMIC_REFERENCE_ARRAY}->length()I`, { id: ARRAY_FIRST, anyReceiver: true }], [`${ATOMIC_REFERENCE_ARRAY}->get(I)Ljava/lang/Object;`, { id: ARRAY_FIRST + 1, anyReceiver: true }],
  [`${ATOMIC_REFERENCE_ARRAY}->set(ILjava/lang/Object;)V`, { id: ARRAY_FIRST + 2, anyReceiver: true }], [`${ATOMIC_REFERENCE_ARRAY}->lazySet(ILjava/lang/Object;)V`, { id: ARRAY_FIRST + 2, anyReceiver: true }],
  [`${ATOMIC_REFERENCE_ARRAY}->getAndSet(ILjava/lang/Object;)Ljava/lang/Object;`, { id: ARRAY_FIRST + 3, anyReceiver: true }],
  [`${ATOMIC_REFERENCE_ARRAY}->compareAndSet(ILjava/lang/Object;Ljava/lang/Object;)Z`, { id: ARRAY_FIRST + 4, anyReceiver: true }],
  [`${ATOMIC_REFERENCE_ARRAY}->weakCompareAndSet(ILjava/lang/Object;Ljava/lang/Object;)Z`, { id: ARRAY_FIRST + 4, anyReceiver: true }],
  // AtomicInteger (weakCompareAndSet too), AtomicLong, AtomicBoolean and AtomicReference over their payloads: the natives check the receiver's class and state themselves (atomics.c)
  [`${ATOMIC_INTEGER}->weakCompareAndSet(II)Z`, { id: BRIDGE_FIRST + 11, anyReceiver: true }],
  ...ATOMIC_OPERATIONS.flatMap(([owner, type, names, params, result], id) => names.map(name => [`${owner}->${name}(${params.replaceAll('T', type)})${result.replace('T', type)}`, { id: ATOMICS_FIRST + id, anyReceiver: true }])),
  // Boolean.valueOf(boolean): the host's TRUE or FALSE record (host-bridge.js fills HostState.booleanBox when boxPrimitive('Z') answers it)
  ['Ljava/lang/Boolean;->valueOf(Z)Ljava/lang/Boolean;', { id: BOOLEAN_VALUE_OF }],
  // the paint host's own bridges (src/paint-host.js) over the Paint record's payload; the natives check the receiver's class flag and the payload's state themselves (paint.h)
  // `superCalls`: also a super call's host-method record (TextPaint.set's super.set(Paint)): its target is Paint's own method whatever the receiver (paint.h)
  ...PAINT_NATIVES.map((method, i) => [`${PAINT}->${method}`, { id: PAINT_FIRST + i, anyReceiver: true, superCalls: true }]),
]);
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
