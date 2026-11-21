import { APKError } from './apk-error.js?v=af8ff7411a95';
import { Invoke } from './interpreter.js?v=af8ff7411a95';
import { createHostRegistry } from './host-contract.js?v=af8ff7411a95';

// java.lang.invoke on the lab VM: what ART's runtime does for the android-13.0.0_r1 libcore originals of framework-aosp/profiles/invoke (art/runtime/method_handles.cc,
// interpreter invoke-polymorphic, java_lang_invoke_MethodHandleImpl.cc). The classes themselves -- MethodHandles.Lookup, MethodHandle, MethodHandleImpl, MethodType, Transformers
// (bindTo, asType, spreaders, invokeWithArguments ...), EmulatedStackFrame -- are the originals; only the runtime's part is here:
//   - invoke-polymorphic (MethodHandle.invoke / invokeExact with the call site's proto): an exact type match invokes the handle; invokeExact with another type is
//     WrongMethodTypeException; invoke with another type is MethodHandle.asType(callsiteType) and then the exact invocation (the definition of invoke). A handle of a
//     Transformer kind gets an EmulatedStackFrame of the call site's type and runs MethodHandle.transformInternal(frame) (the ArtMethod every Transformer carries); the
//     other kinds invoke their member as ART does: INVOKE_VIRTUAL / INVOKE_INTERFACE dispatch on the receiver, INVOKE_DIRECT the method itself, INVOKE_SUPER the
//     method as seen from the superclass of the handle's receiver type (an interface's default method itself), INVOKE_STATIC, and IGET / IPUT / SGET / SPUT the field;
//   - MethodHandle.invokeExactWithFrame(EmulatedStackFrame) (the Transformers' way back into the runtime): the arguments from the frame, the result into it;
//   - MethodHandleImpl.getMemberInternal; the hidden reflection members the originals call: Executable.getArtMethod, Field.getArtField, Class.getInstanceMethod.
// artFieldOrMethod is ART's ArtMethod* / ArtField*: here the value Executable.artMethod reads (src/hidden-members.js: the ArtMethod the lab lays out in the ARM64 process, else the jmethodID), or the field's ArtField* / jfieldID; the lab
// remembers which member each value names. VarHandle access modes are not provided: they fail naming the API.
const MH = 'Ljava/lang/invoke/MethodHandle;', MT = 'Ljava/lang/invoke/MethodType;', ESF = 'Ldalvik/system/EmulatedStackFrame;', CLASS = 'Ljava/lang/Class;', OBJECT = 'Ljava/lang/Object;';
const MH_TYPE = `${MH}->type:${MT}`, MH_KIND = `${MH}->handleKind:I`, MH_ART = `${MH}->artFieldOrMethod:J`;
const MT_RTYPE = `${MT}->rtype:${CLASS}`, MT_PTYPES = `${MT}->ptypes:[${CLASS}`;
const ESF_TYPE = `${ESF}->type:${MT}`, ESF_REFS = `${ESF}->references:[${OBJECT}`, ESF_BYTES = `${ESF}->stackFrame:[B`;
const INVOKE_VIRTUAL = 0, INVOKE_SUPER = 1, INVOKE_DIRECT = 2, INVOKE_STATIC = 3, INVOKE_INTERFACE = 4, INVOKE_TRANSFORM = 5, INVOKE_VAR_HANDLE = 6, INVOKE_VAR_HANDLE_EXACT = 7;
const IGET = 8, IPUT = 9, SGET = 10, SPUT = 11;
const isNull = value => value === null || value === 0 || value === undefined;
const isWide = type => type === 'J' || type === 'D';
const isPrimitive = type => type.length === 1;

/** The member each artFieldOrMethod value names (per runtime), methods and fields apart (a jmethodID and a jfieldID may be the same number; an ArtMethod* and an ArtField* are not). */
const membersOf = (rt, field) => (field ? (rt.methodHandleFields ??= new Map()) : (rt.methodHandleMethods ??= new Map()));
/** Executable.getArtMethod / Field.getArtField: the value ART's artMethod / artField holds, remembered with the member it names. */
function artValue(rt, member) {
  let id;
  if (member.method) {
    if (rt.jni?.artMethodOf) id = rt.jni.artMethodOf(member);   // the ArtMethod* of the ARM64 process when there is one (src/arm64/art-runtime.js), else the jmethodID
    else { const keys = rt.methodHandleIds ??= new Map(); id = keys.get(member.method.key) ?? keys.set(member.method.key, 0x10000 + keys.size).get(member.method.key); }
  } else {
    if (rt.jni?.artFieldOf) id = rt.jni.artFieldOf(member);
    else { const keys = rt.methodHandleIds ??= new Map(), key = member.field.key + (member.flags & 8 ? '#s' : ''); id = keys.get(key) ?? keys.set(key, 0x10000 + keys.size).get(key); }
  }
  const value = BigInt(id);
  membersOf(rt, !member.method).set(value, { ...member });
  return value;
}
const memberOf = (rt, value, field) => {
  const member = membersOf(rt, field).get(BigInt.asIntN(64, BigInt(value ?? 0)));
  if (!member) throw new APKError(`MethodHandle.artFieldOrMethod ${value} names no member this VM handed out (Executable.getArtMethod / Field.getArtField)`, { kind: 'method-handle-member' });
  return member;
};

// ---- types
const typeOfClass = (rt, cls) => { const type = rt.object(cls).classType; if (!type) throw new APKError('MethodType holds an object that is not a Class', { kind: 'internal' }); return type; };
/** The parameter and return descriptors of a MethodType object. */
function methodTypeOf(rt, mt) {
  if (isNull(mt)) throw new APKError('MethodHandle without a MethodType', { kind: 'internal' });
  const fields = rt.object(mt).fields, rtype = fields.get(MT_RTYPE), ptypes = fields.get(MT_PTYPES);
  return { parameters: isNull(ptypes) ? [] : rt.array(ptypes).elements.map(cls => typeOfClass(rt, cls)), result: typeOfClass(rt, rtype) };
}
const descriptorOf = type => `(${type.parameters.join('')})${type.result}`;
const pretty = type => {
  const name = t => { let dims = ''; while (t[0] === '[') { dims += '[]'; t = t.slice(1); } const base = { Z: 'boolean', B: 'byte', C: 'char', S: 'short', I: 'int', J: 'long', F: 'float', D: 'double', V: 'void' }[t] ?? t.slice(1, -1).replaceAll('/', '.'); return base + dims; };
  return `(${type.parameters.map(name).join(',')})${name(type.result)}`;
};
/** A MethodType object for descriptors: MethodType.methodType(Class, Class[]) (the original). */
function methodTypeObject(rt, type, then) {
  const ptypes = rt.newArray(`[${CLASS}`, type.parameters.length); rt.array(ptypes).elements = type.parameters.map(t => rt.classObject(t));
  return new Invoke({ owner: MT, name: 'methodType', parameters: [CLASS, `[${CLASS}`], result: MT, signature: `(${CLASS}[${CLASS})${MT}` }, [rt.classObject(type.result), ptypes], 'static', then);
}
const handleType = (rt, handle) => methodTypeOf(rt, rt.object(handle).fields.get(MH_TYPE));
const handleKind = (rt, handle) => rt.object(handle).fields.get(MH_KIND) ?? 0;

// ---- invoke-polymorphic
/** invoke-polymorphic: `method` is MethodHandle.invoke / invokeExact (or a VarHandle access mode) with the call site's proto; `words` the receiver and the arguments. */
export function invokePolymorphic(rt, method, words) {
  const declared = method.declared ?? method, values = rt.compactArguments(method, words, 'virtual'), handle = values[0], args = values.slice(1);
  if (isNull(handle)) rt.throwJava('Ljava/lang/NullPointerException;', `Attempt to invoke virtual method '${declared.name}' on a null object reference`);
  if (!rt.isSubtype(rt.typeOf(handle), MH)) {
    if (rt.isSubtype(rt.typeOf(handle), 'Ljava/lang/invoke/VarHandle;')) throw new APKError(`Unsupported API/method: Ljava/lang/invoke/VarHandle;->${method.name}${method.signature} (VarHandle access modes are not provided by the lab VM)`, { kind: 'unsupported-api', method: `Ljava/lang/invoke/VarHandle;->${method.name}` });
    throw new APKError(`invoke-polymorphic of ${method.key} on a ${rt.typeOf(handle)}`, { kind: 'internal' });
  }
  if (method.name !== 'invoke' && method.name !== 'invokeExact') throw new APKError(`Unsupported API/method: ${MH}->${method.name}${method.signature} (polymorphic)`, { kind: 'unsupported-api' });
  const callsite = { parameters: method.parameters, result: method.result }, type = handleType(rt, handle);
  if (descriptorOf(type) === descriptorOf(callsite)) return invokeExact(rt, handle, args, callsite);
  if (method.name === 'invokeExact') rt.throwJava('Ljava/lang/invoke/WrongMethodTypeException;', `Expected ${pretty(type)} but was ${pretty(callsite)}`);
  // invoke: asType(callsiteType).invokeExact(...)
  return methodTypeObject(rt, callsite, mt => new Invoke({ owner: MH, name: 'asType', parameters: [MT], result: MH, signature: `(${MT})${MH}` }, [handle, mt], 'virtual',
    adapted => invokeExact(rt, adapted, args, callsite)));
}

/** The exact invocation of `handle` with argument values of `type` (its own type); the result is a value of type.result. */
function invokeExact(rt, handle, args, type) {
  const kind = handleKind(rt, handle);
  if (kind === INVOKE_TRANSFORM) {
    return newFrame(rt, type, frame => {
      writeFrameArguments(rt, frame, type, args);
      return new Invoke({ owner: MH, name: 'transformInternal', parameters: [ESF], result: 'V', signature: `(${ESF})V` }, [handle, frame], 'direct', () => readFrameResult(rt, frame, type));
    });
  }
  return invokeMember(rt, handle, kind, args, type, value => value);
}

/** Invokes the member of a handle of kind 0..4 or 8..11; `then` gets the result value. */
function invokeMember(rt, handle, kind, args, type, then) {
  if (kind === INVOKE_VAR_HANDLE || kind === INVOKE_VAR_HANDLE_EXACT) throw new APKError('Unsupported API/method: a MethodHandle of a VarHandle access mode (MethodHandles.varHandleInvoker / varHandleExactInvoker): VarHandle access modes are not provided by the lab VM', { kind: 'unsupported-api' });
  const member = memberOf(rt, rt.object(handle).fields.get(MH_ART), kind >= IGET && kind <= SPUT);
  if (kind >= IGET && kind <= SPUT) return then(fieldAccess(rt, kind, member, args));
  const target = member.method; if (!target) throw new APKError(`MethodHandle of kind ${kind} names a field`, { kind: 'internal' });
  const staticCall = kind === INVOKE_STATIC;
  if (!staticCall && isNull(args[0])) rt.throwJava('Ljava/lang/NullPointerException;', `Attempt to invoke a method handle on a null object reference (${target.name})`);
  let method = target, mode = kind === INVOKE_STATIC ? 'static' : kind === INVOKE_DIRECT ? 'direct' : 'virtual';
  if (kind === INVOKE_SUPER) {
    // ART: the method as the superclass of the handle's receiver type sees it; an interface's method is that default method itself (FindVirtualMethodForInterfaceSuper)
    mode = 'direct';
    if (!rt.isInterfaceType?.(target.owner) && !rt.classes.get(target.owner)?.isInterface) {
      const referrer = type.parameters[0];
      for (let owner = rt.classes.get(referrer)?.superclass ?? rt.parent?.(referrer); owner; owner = rt.classes.get(owner)?.superclass ?? null) {
        const cls = rt.classes.get(owner); if (!cls) { method = { ...target, owner }; mode = 'super'; break; }
        const definition = cls.methods.get(target.name + target.signature);
        if (definition && !(definition.flags & 0x400)) { method = { ...target, owner, key: `${owner}->${target.name}${target.signature}` }; break; }
      }
    }
  }
  const parameters = target.parameters, values = staticCall ? args : args.slice(1);
  if (values.length !== parameters.length) throw new APKError(`MethodHandle invocation of ${target.key} with ${values.length} arguments`, { kind: 'internal' });
  const words = rt.argumentWords(parameters, values, staticCall ? {} : { receiver: args[0] });
  if (target.name === '<init>' && kind === INVOKE_DIRECT) return new Invoke(method, words, 'direct', () => then(undefined));
  return new Invoke(method, words, mode, value => then(value));
}

/** IGET / IPUT / SGET / SPUT of a field member (the handle's type has already the field's types). */
function fieldAccess(rt, kind, member, args) {
  const field = member.field, statics = kind === SGET || kind === SPUT;
  if (!statics && isNull(args[0])) rt.throwJava('Ljava/lang/NullPointerException;', `Attempt to read or write field '${field.name}' on a null object reference`);
  if (kind === SGET) return rt.readStatic(field);
  if (kind === SPUT) { rt.writeStatic(field, args[0]); return undefined; }
  const target = rt.object(args[0]);
  if (kind === IGET) return target.fields.has(field.key) ? target.fields.get(field.key) : isPrimitive(field.type) ? (isWide(field.type) ? 0n : 0) : null;
  rt.storeField(target.fields, field.key, args[1]); return undefined;
}

// ---- EmulatedStackFrame (the original's layout: references in order, then the reference result; primitives little-endian, 4 bytes or 8 for long/double, then the primitive result)
function newFrame(rt, type, then) {
  return methodTypeObject(rt, type, mt => new Invoke({ owner: ESF, name: 'create', parameters: [MT], result: ESF, signature: `(${MT})${ESF}` }, [mt], 'static', then));
}
const frameParts = (rt, frame) => { const fields = rt.object(frame).fields; return { refs: rt.array(fields.get(ESF_REFS)).elements, bytes: rt.array(fields.get(ESF_BYTES)).elements }; };
function putBytes(bytes, at, value, size) {
  let v = BigInt.asUintN(64, BigInt(value));
  for (let i = 0; i < size; i++) { const b = Number(v & 0xffn); bytes[at + i] = b > 127 ? b - 256 : b; v >>= 8n; }
}
function getBytes(bytes, at, size, signed = true) {
  let v = 0n; for (let i = size - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[at + i] & 0xff);
  return size === 8 ? BigInt.asIntN(64, v) : Number(BigInt.asIntN(32, v));
}
const primitiveWord = (type, value) => type === 'Z' ? (value ? 1 : 0) : Number(value) | 0;
const narrowPrimitive = (type, value) => type === 'Z' ? value & 1 : type === 'B' ? (value << 24) >> 24 : type === 'C' ? value & 0xffff : type === 'S' ? (value << 16) >> 16 : value;
function writeFrameArguments(rt, frame, type, args) {
  const { refs, bytes } = frameParts(rt, frame); let r = 0, at = 0;
  type.parameters.forEach((t, i) => {
    if (!isPrimitive(t)) refs[r++] = isNull(args[i]) ? null : args[i];
    else if (isWide(t)) { putBytes(bytes, at, args[i], 8); at += 8; }
    else { putBytes(bytes, at, primitiveWord(t, args[i]), 4); at += 4; }
  });
}
function readFrameArguments(rt, frame, type) {
  const { refs, bytes } = frameParts(rt, frame), out = []; let r = 0, at = 0;
  for (const t of type.parameters) {
    if (!isPrimitive(t)) out.push(refs[r++] ?? null);
    else if (isWide(t)) { out.push(getBytes(bytes, at, 8)); at += 8; }
    else { out.push(narrowPrimitive(t, getBytes(bytes, at, 4))); at += 4; }
  }
  return out;
}
function readFrameResult(rt, frame, type) {
  const t = type.result; if (t === 'V') return undefined;
  const { refs, bytes } = frameParts(rt, frame);
  if (!isPrimitive(t)) return refs[refs.length - 1] ?? null;
  return isWide(t) ? getBytes(bytes, bytes.length - 8, 8) : narrowPrimitive(t, getBytes(bytes, bytes.length - 4, 4));
}
function writeFrameResult(rt, frame, type, value) {
  const t = type.result; if (t === 'V') return;
  const { refs, bytes } = frameParts(rt, frame);
  if (!isPrimitive(t)) refs[refs.length - 1] = isNull(value) ? null : value;
  else if (isWide(t)) putBytes(bytes, bytes.length - 8, value ?? 0n, 8);
  else putBytes(bytes, bytes.length - 4, primitiveWord(t, value ?? 0), 4);
}

// ---- natives of the originals (framework native bindings, keyed by method)
export function methodHandleNativeBindings(bindings) {
  // MethodHandle.invoke / invokeExact reached as ordinary methods (reflection, JNI): ART refuses them, they are signature-polymorphic
  for (const name of ['invoke', 'invokeExact']) bindings.set(`${MH}->${name}([${OBJECT})${OBJECT}`, rt => rt.throwJava('Ljava/lang/UnsupportedOperationException;', `MethodHandle.${name} cannot be invoked reflectively`));
  // invokeExactWithFrame(EmulatedStackFrame): the Transformers' call of a handle with the arguments of a frame of the handle's own type
  bindings.set(`${MH}->invokeExactWithFrame(${ESF})V`, (rt, [handle, frame]) => {
    if (isNull(frame)) rt.throwJava('Ljava/lang/NullPointerException;', 'frame');
    const kind = handleKind(rt, handle);
    if (kind === INVOKE_TRANSFORM) return new Invoke({ owner: MH, name: 'transformInternal', parameters: [ESF], result: 'V', signature: `(${ESF})V` }, [handle, frame], 'direct', () => undefined);
    const type = handleType(rt, handle), frameType = methodTypeOf(rt, rt.object(frame).fields.get(ESF_TYPE));
    if (descriptorOf(type) !== descriptorOf(frameType)) rt.throwJava('Ljava/lang/invoke/WrongMethodTypeException;', `Expected ${pretty(type)} but was ${pretty(frameType)}`);
    return invokeMember(rt, handle, kind, readFrameArguments(rt, frame, type), type, value => { writeFrameResult(rt, frame, type, value); return undefined; });
  });
  // MethodHandleImpl.getMemberInternal: the reflected member of the handle's artFieldOrMethod
  bindings.set('Ljava/lang/invoke/MethodHandleImpl;->getMemberInternal()Ljava/lang/reflect/Member;', (rt, [handle]) => {
    const kind = handleKind(rt, handle), member = memberOf(rt, rt.object(handle).fields.get(MH_ART), kind >= IGET && kind <= SPUT);
    return rt.reflectionObject(member.field ? 'field' : member.method.name === '<init>' ? 'constructor' : 'method', member);
  });
  return bindings;
}

// ---- hidden reflection members the originals call (host classes of the lab)
export function createMethodHandlesHost() {
  const registry = createHostRegistry(), { def } = registry;
  const memberOfObject = (rt, self) => { const member = rt.object(self).member; if (!member) throw new APKError('A reflection object without its member', { kind: 'internal' }); return member; };
  for (const owner of ['Ljava/lang/reflect/Executable;', 'Ljava/lang/reflect/Method;', 'Ljava/lang/reflect/Constructor;']) def(owner, 'getArtMethod', '()J', (rt, _m, [self]) => { const member = memberOfObject(rt, self); if (!member.method) throw new APKError('Executable.getArtMethod of a field', { kind: 'internal' }); return artValue(rt, member); });
  def('Ljava/lang/reflect/Field;', 'getArtField', '()J', (rt, _m, [self]) => { const member = memberOfObject(rt, self); if (!member.field) throw new APKError('Field.getArtField of a method', { kind: 'internal' }); return artValue(rt, member); });
  // Class.getInstanceMethod(name, parameterTypes) (hidden, libcore Class.java): a non-static method declared by the class or a superclass, else a public method of an interface; null when none
  const sameParameters = (rt, method, types) => method.parameters.length === types.length && method.parameters.every((p, i) => p === types[i]);
  const reflected = (rt, cls, name) => { const out = rt.dispatch({ owner: CLASS, name, parameters: [], result: '[Ljava/lang/reflect/Method;', signature: '()[Ljava/lang/reflect/Method;' }, [cls], 'virtual'); return isNull(out) ? [] : rt.array(out).elements; };
  def(CLASS, 'getInstanceMethod', `(Ljava/lang/String;[${CLASS})Ljava/lang/reflect/Method;`, (rt, _m, [self, name, parameterTypes]) => {
    if (isNull(name)) rt.throwJava('Ljava/lang/NullPointerException;', 'name == null');
    const text = typeof name === 'string' ? name : rt.stringCharacters(name), types = isNull(parameterTypes) ? [] : rt.array(parameterTypes).elements.map(c => typeOfClass(rt, c));
    for (let cls = self; !isNull(cls); cls = rt.dispatch({ owner: CLASS, name: 'getSuperclass', parameters: [], result: CLASS, signature: `()${CLASS}` }, [cls], 'virtual')) {
      const found = reflected(rt, cls, 'getDeclaredMethods').find(m => { const member = rt.object(m).member; return member?.method?.name === text && sameParameters(rt, member.method, types); });
      if (found && !(rt.object(found).member.flags & 8)) return found;
    }
    return reflected(rt, self, 'getMethods').find(m => { const member = rt.object(m).member; return member?.method?.name === text && sameParameters(rt, member.method, types) && !(member.flags & 8) && (member.flags & 1); }) ?? null;
  });
  return registry;
}
