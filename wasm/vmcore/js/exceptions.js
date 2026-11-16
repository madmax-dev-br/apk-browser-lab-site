// vmcore exceptions, the JavaScript side (vmcore/exceptions.h): the details of each exception object the core reports through env.exception -- its message, its cause and its
// captured stack -- kept by object address until strings and Throwable's fields live in the core (the message the JavaScript VM gives, APKRuntime.throwJava and the host
// Throwable constructors). The well-known classes (VM.exceptionClasses) are laid out by the linker in the order of WELL_KNOWN.
//
// Lifetime: a record is replaced when another exception is reported at the same address. Nothing here is a root: a cause referenced only from here can be collected (Throwable
// fields in the core will hold it), and a record of a freed object stays until its address is reused by another exception.

/** VM.exceptionClasses[kind] (exceptions.h EXC_*). */
export const WELL_KNOWN = ['Ljava/lang/NullPointerException;', 'Ljava/lang/ArrayIndexOutOfBoundsException;', 'Ljava/lang/ArithmeticException;', 'Ljava/lang/ClassCastException;',
  'Ljava/lang/NegativeArraySizeException;', 'Ljava/lang/StackOverflowError;', 'Ljava/lang/OutOfMemoryError;', 'Ljava/lang/ExceptionInInitializerError;', 'Ljava/lang/NoClassDefFoundError;',
  'Ljava/lang/Error;', 'Ljava/lang/StringIndexOutOfBoundsException;', 'Ljava/lang/ArrayStoreException;',
  'Ljava/lang/AbstractMethodError;', 'Ljava/lang/IncompatibleClassChangeError;', 'Ljava/lang/NoSuchFieldError;', 'Ljava/lang/NoSuchMethodError;',
  'Ljava/lang/IllegalMonitorStateException;', 'Ljava/lang/InterruptedException;', 'Ljava/lang/IllegalArgumentException;'];   // threads.h: monitor-exit, Object.wait/notify
export const RESOLVE_WELL_KNOWN = 0xffffff00;
const EVENT_CREATED = 1, EVENT_CONSTRUCTED = 2, EVENT_WRAPPED = 3, THROWABLE = 'Ljava/lang/Throwable;', STRING = 'Ljava/lang/String;';
const LONG_OPS = new Set([0x9e, 0x9f, 0xbe, 0xbf]), REMAINDER_OPS = new Set([0x94, 0x9f, 0xb4, 0xbf, 0xd4, 0xdc]);

/** exceptions.h EXC_MESSAGE + n: the fixed messages of the JavaScript VM's bridges that the C natives stand for (src/apk-runtime.js: the String bridge, System.arraycopy). */
export const EXC_MESSAGE = 0xfffe0000;
/** exceptions.h EXC_LINK: the message is the one the linker kept for the thread (a link error: NoSuchMethodError, NoSuchFieldError, the NoClassDefFoundError of resolution...). */
export const EXC_LINK = 0xfffd0000;
export const NATIVE_MESSAGES = ['String index out of bounds', 'String argument is null', 'null comparison string', 'String comparison requires String',
  'System.arraycopy requires arrays', 'System.arraycopy primitive array type mismatch', 'System.arraycopy bounds error', 'Invalid String char array range',
  'object not locked by thread before notify()', 'object not locked by thread before notifyAll()', 'object not locked by thread before wait()',   // the bridge of Object.wait/notify (threads.c)
  'timeout value is negative', 'nanosecond timeout value out of range'];

const dotted = type => type ? type.replace(/^L(.*);$/, '$1').replaceAll('/', '.') : String(type);
const PRIMITIVES = { I: 'int', J: 'long', D: 'double', F: 'float', Z: 'boolean', B: 'byte', S: 'short', C: 'char', V: 'void' };
/** A descriptor as ART's PrettyDescriptor prints it: I -> int, Ljava/lang/String; -> java.lang.String, [B -> byte[]. */
const pretty = type => type[0] === '[' ? pretty(type.slice(1)) + '[]' : PRIMITIVES[type] ?? dotted(type);
/** ART's PrettyMethod of a method key 'Lowner;->name(params)result': "int dev.Owner.name(int, java.lang.String)". */
function prettyMethod(key) {
  const [, owner, name, params, result] = /^(L[^;]+;)->([^(]+)\((.*)\)(.+)$/.exec(key) ?? [], types = [];
  if (!owner) return key;
  for (let i = 0; i < params.length; i++) { const at = i; while (params[i] === '[') i++; if (params[i] === 'L') i = params.indexOf(';', i); types.push(params.slice(at, i + 1)); }
  return `${pretty(result)} ${dotted(owner)}.${name}(${types.map(pretty).join(', ')})`;
}

export class Exceptions {
  constructor(linker) {
    this.linker = linker; this.records = new Map(); this.decodeString = null;
    this.imports = { exception: (t, event, object, a, b, c, stack, count) => this.event(event >>> 0, object >>> 0, a >>> 0, b >>> 0, c >>> 0, stack >>> 0, count >>> 0, t >>> 0) };
  }

  /** The message the JavaScript VM gives a runtime exception of `kind` (WELL_KNOWN index) with the core's details. */
  message(kind, b, c, thread = 0) {
    const describe = address => this.linker.describe(address);
    if (b >>> 0 === EXC_LINK) return this.linker.takeLinkError(thread);
    if ((b & 0xffff0000) >>> 0 === EXC_MESSAGE) return NATIVE_MESSAGES[b & 0xffff] ?? null;
    switch (kind) {
      case 0: return b === 0x27 ? 'throw with null exception' : b === 0x1d || b === 0x1e ? 'null monitor' : 'null object reference';
      case 1: return `array index ${b | 0} outside length ${c}`;
      case 2: return `${LONG_OPS.has(b) ? 'Long' : 'Integer'} ${REMAINDER_OPS.has(b) ? 'remainder' : 'divide'} by zero`;
      case 3: return `Cannot cast ${describe(b)} to ${describe(c)}`;
      case 4: return `negative array length ${b | 0}`;
      case 5: return 'stack size 1MB';
      case 6: return 'Failed to allocate: the heap is full after a collection';
      case 8: return c === 1 ? `Failed resolution of: ${describe(b).replace(/^\[+/, '')}` : `Could not initialize class ${dotted(describe(b))}`;   // c = 1: a class that exists nowhere (CLASS_MISSING)
      case 11: return `${describe(b)} into ${describe(c)}`;   // APKRuntime.checkArrayValue: the value's class, the array's class
      case 12: return `abstract method "${prettyMethod(this.linker.methodList[b]?.key ?? String(b))}"`;   // ART's ThrowAbstractMethodError: the method id
      case 13: return `Class ${pretty(describe(b))} does not implement interface ${pretty(describe(c))}`;   // ART's ThrowIncompatibleClassChangeErrorClassForInterfaceDispatch: the receiver's class, the interface
      case 16: return 'monitor not owned';   // monitor-exit (APKRuntime.monitorExit, without the lab's diagnostic suffix)
      default: return null;
    }
  }

  /** Captured (method id, pc) pairs as { method, key, pc }, without the leading constructors of Throwable classes (APKRuntime.captureStack). */
  stack(at, count) {
    const u32 = this.linker.u32, out = []; let leading = true;
    for (let i = 0; i < count; i++) {
      const mi = this.linker.methodList[u32[(at >>> 2) + 2 * i]], pc = u32[(at >>> 2) + 2 * i + 1];
      if (leading && mi?.name === '<init>' && this.linker.isThrowable(mi.owner)) continue;
      leading = false; out.push({ method: mi?.id, key: mi?.key, pc });
    }
    return out;
  }

  /** The text of a String record of the core: through the boundary's decoder when one is set (`decodeString`, the harness's RecordSpace), else a placeholder. */
  text(address) {
    if (!address) return null;
    return this.decodeString ? this.decodeString(address) : `<string at ${address}>`;
  }

  event(event, object, a, b, c, stackAt, count, thread = 0) {
    const stack = this.stack(stackAt, count);
    if (event === EVENT_CREATED) { this.records.set(object, { message: this.message(a, b, c, thread), cause: null, stack }); return; }
    if (event === EVENT_WRAPPED) { this.records.set(object, { message: null, cause: a, stack }); return; }
    if (event === EVENT_CONSTRUCTED) {   // the host Throwable constructors of the JavaScript VM: (), (String), (String, Throwable), (Throwable), ArrayIndexOutOfBoundsException(int)
      const mi = this.linker.methodList[a], u32 = this.linker.u32, parameters = mi?.parameters ?? [], word = i => u32[(b >>> 2) + 1 + i];
      let message = null, cause = null;
      if (mi?.owner.type === 'Ljava/lang/ArrayIndexOutOfBoundsException;' && parameters[0] === 'I') message = `Array index out of range: ${word(0) | 0}`;
      else if (parameters[0] === STRING) message = this.text(word(0));
      if (parameters[0] === THROWABLE) cause = word(0) || null;
      else if (parameters[1] === THROWABLE) cause = word(1) || null;
      this.records.set(object, { message, cause, stack });
    }
  }

  /** What is known of exception object `address`: its class, and the message, cause and stack recorded for it. */
  describe(address) {
    if (!address) return null;
    return { address, type: this.linker.describe(this.linker.u32[address >>> 2]), message: null, cause: null, stack: [], ...this.records.get(address) };
  }
}
