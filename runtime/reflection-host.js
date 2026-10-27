import { gcRoot } from './heap-gc.js?v=79e2ded60c95';
import { APKError } from './apk-error.js?v=79e2ded60c95';
import { createHostRegistry } from './host-contract.js?v=79e2ded60c95';

// Generic-type reflection and java.lang.reflect.Proxy for the libraries that wire themselves up with reflection at launch (Retrofit, Gson, Moshi, Koin, Dagger,
// Room, WorkManager). Contracts: java.lang.Class / java.lang.reflect.{Method,Constructor,Field,Proxy,Type,ParameterizedType,TypeVariable,WildcardType,GenericArrayType}
// and libcore.reflect (android-13.0.0_r1). Generic information is read from the DEX `dalvik.annotation.Signature` annotation (JVMS 4.7.9.1 grammar), the way ART's
// libcore.reflect.GenericSignatureParser does; the Type objects are host classes named after libcore's (ParameterizedTypeImpl, TypeVariableImpl, ...).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', CLASS = 'Ljava/lang/Class;', TYPE = 'Ljava/lang/reflect/Type;', METHOD = 'Ljava/lang/reflect/Method;', CONSTRUCTOR = 'Ljava/lang/reflect/Constructor;', FIELD = 'Ljava/lang/reflect/Field;';
const PARAMETERIZED = 'Ljava/lang/reflect/ParameterizedType;', TYPE_VARIABLE = 'Ljava/lang/reflect/TypeVariable;', WILDCARD = 'Ljava/lang/reflect/WildcardType;', GENERIC_ARRAY = 'Ljava/lang/reflect/GenericArrayType;', GENERIC_DECLARATION = 'Ljava/lang/reflect/GenericDeclaration;';
const PT = 'Llibcore/reflect/ParameterizedTypeImpl;', TV = 'Llibcore/reflect/TypeVariableImpl;', WT = 'Llibcore/reflect/WildcardTypeImpl;', GAT = 'Llibcore/reflect/GenericArrayTypeImpl;';
const ANNOTATION = 'Ljava/lang/annotation/Annotation;', SIGNATURE = 'Ldalvik/annotation/Signature;', INVOCATION_HANDLER = 'Ljava/lang/reflect/InvocationHandler;', PROXY = 'Ljava/lang/reflect/Proxy;', UNDECLARED = 'Ljava/lang/reflect/UndeclaredThrowableException;';

// ---- generic signature grammar --------------------------------------------------------------------------------------------------------------------
class SignatureReader {
  constructor(text) { this.s = text; this.i = 0; }
  peek() { return this.s[this.i]; }
  next() { return this.s[this.i++]; }
  until(stops) { const start = this.i; while (this.i < this.s.length && !stops.includes(this.s[this.i])) this.i++; return this.s.slice(start, this.i); }
  expect(c) { if (this.next() !== c) throw new APKError(`Malformed generic signature ${this.s}`, { kind: 'bad-generic-signature' }); }
  formals() {
    const formals = []; if (this.peek() !== '<') return formals; this.next();
    while (this.peek() !== '>') {
      const name = this.until(':'), bounds = [];
      while (this.peek() === ':') { this.next(); if (this.peek() === ':') continue; bounds.push(this.type()); }
      formals.push({ name, bounds });
    }
    this.next(); return formals;
  }
  type() {
    const c = this.peek();
    if (c === 'L') return this.classType();
    if (c === 'T') { this.next(); const name = this.until(';'); this.expect(';'); return { k: 'tvar', name }; }
    if (c === '[') { this.next(); return { k: 'array', comp: this.type() }; }
    this.next(); return { k: 'prim', d: c };
  }
  args() {
    this.expect('<'); const args = [];
    while (this.peek() !== '>') {
      const c = this.peek();
      if (c === '*') { this.next(); args.push({ k: 'wild', upper: [], lower: [] }); }
      else if (c === '+') { this.next(); args.push({ k: 'wild', upper: [this.type()], lower: [] }); }
      else if (c === '-') { this.next(); args.push({ k: 'wild', upper: [], lower: [this.type()] }); }
      else args.push(this.type());
    }
    this.next(); return args;
  }
  classType() {
    this.expect('L'); let name = this.until('<;.'), node = { k: 'class', raw: `L${name};`, args: [], owner: null };
    if (this.peek() === '<') node.args = this.args();
    while (this.peek() === '.') { this.next(); name += '$' + this.until('<;.'); node = { k: 'class', raw: `L${name};`, args: this.peek() === '<' ? this.args() : [], owner: node }; }
    this.expect(';'); return node;
  }
}
export const parseClassSignature = text => { const r = new SignatureReader(text), formals = r.formals(), superclass = r.type(), interfaces = []; while (r.i < text.length) interfaces.push(r.type()); return { formals, superclass, interfaces }; };
export const parseMethodSignature = text => {
  const r = new SignatureReader(text), formals = r.formals(), params = []; r.expect('(');
  while (r.peek() !== ')') params.push(r.type());
  r.next(); const result = r.type(), throws = []; while (r.peek() === '^') { r.next(); throws.push(r.type()); }
  return { formals, params, result, throws };
};
export const parseFieldSignature = text => new SignatureReader(text).type();

export function createReflectionHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const array = (r, element, items) => { const a = r.newArray(`[${element}`, items.length); r.array(a).elements = items; return a; };
  const dispatchVirtual = (r, owner, name, parameters, result, args) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'virtual');
  const text = (r, value) => value === null ? 'null' : r.stringCharacters(value);

  // ---- Type hierarchy -----------------------------------------------------------------------------------------------------------------------
  for (const [iface, parents] of [[TYPE, []], [GENERIC_DECLARATION, []], [PARAMETERIZED, [TYPE]], [TYPE_VARIABLE, [TYPE]], [WILDCARD, [TYPE]], [GENERIC_ARRAY, [TYPE]]]) { type(iface, OBJECT, parents); registry.interfaces.set(iface, parents); }
  type(PT, OBJECT, [PARAMETERIZED], { allocatable: true }); type(TV, OBJECT, [TYPE_VARIABLE], { allocatable: true }); type(WT, OBJECT, [WILDCARD], { allocatable: true }); type(GAT, OBJECT, [GENERIC_ARRAY], { allocatable: true });

  /** Class.getTypeName: arrays print as component[] (Class.getName for everything else). */
  function typeName(r, ref) {
    const t = r.object(ref).classType;
    if (t !== undefined) { const dims = /^\[*/.exec(t)[0].length, base = t.slice(dims); return r.className(base.length === 1 ? base : base, 'binary') + '[]'.repeat(dims); }
    return text(r, dispatchVirtual(r, OBJECT, 'toString', [], STRING, [ref]));
  }
  const typeNames = (r, refs, separator) => refs.map(ref => typeName(r, ref)).join(separator);
  const arrayEquals = (r, a, b) => a.length === b.length && a.every((x, i) => r.javaEquals(x, b[i]));
  const arrayHash = (r, a) => a.reduce((h, x) => (Math.imul(h, 31) + r.javaHash(x)) | 0, 1);

  // ParameterizedTypeImpl
  const pt = (r, ref) => r.object(ref).pt;
  const ptParts = (r, ref) => r.object(ref).pt ?? { raw: dispatchVirtual(r, PARAMETERIZED, 'getRawType', [], TYPE, [ref]), args: r.array(dispatchVirtual(r, PARAMETERIZED, 'getActualTypeArguments', [], `[${TYPE}`, [ref])).elements, owner: dispatchVirtual(r, PARAMETERIZED, 'getOwnerType', [], TYPE, [ref]) };
  def(PT, 'getRawType', `()${TYPE}`, (r, _m, [self]) => pt(r, self).raw);
  def(PT, 'getActualTypeArguments', `()[${TYPE}`, (r, _m, [self]) => array(r, TYPE, [...pt(r, self).args]));
  def(PT, 'getOwnerType', `()${TYPE}`, (r, _m, [self]) => { const p = pt(r, self); return p.owner ?? r.dispatch({ owner: CLASS, name: 'getDeclaringClass', parameters: [], result: CLASS, signature: `()${CLASS}` }, [p.raw], 'virtual'); });
  def(PT, 'getTypeName', `()${STRING}`, (r, _m, [self]) => text(r, dispatchVirtual(r, PT, 'toString', [], STRING, [self])));
  def(PT, 'toString', `()${STRING}`, (r, _m, [self]) => {
    const p = pt(r, self), owner = p.owner;
    let out = owner === null ? typeName(r, p.raw) : typeName(r, owner) + '$' + r.className(r.object(p.raw).classType, 'simple');
    if (p.args.length) out += '<' + typeNames(r, p.args, ', ') + '>'; return out;
  });
  def(PT, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (other === null || !r.isSubtype(r.typeOf(other), PARAMETERIZED)) return 0;
    const a = pt(r, self), b = ptParts(r, other), ownerA = a.owner, ownerB = b.owner;
    return r.javaEquals(a.raw, b.raw) && r.javaEquals(ownerA, ownerB) && arrayEquals(r, a.args, b.args) ? 1 : 0;
  });
  def(PT, 'hashCode', '()I', (r, _m, [self]) => { const p = pt(r, self); return (arrayHash(r, p.args) ^ r.javaHash(p.owner) ^ r.javaHash(p.raw)) | 0; });

  // TypeVariableImpl
  const tv = (r, ref) => r.object(ref).tv;
  def(TV, 'getName', `()${STRING}`, (r, _m, [self]) => tv(r, self).name);
  def(TV, 'getBounds', `()[${TYPE}`, (r, _m, [self]) => { const v = tv(r, self); return array(r, TYPE, v.bounds.length ? v.bounds.map(b => materialize(r, b, v.scope)) : [r.classObject(OBJECT)]); });
  def(TV, 'getGenericDeclaration', `()${GENERIC_DECLARATION}`, (r, _m, [self]) => tv(r, self).decl);
  def(TV, 'getTypeName', `()${STRING}`, (r, _m, [self]) => tv(r, self).name);
  def(TV, 'toString', `()${STRING}`, (r, _m, [self]) => tv(r, self).name);
  def(TV, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (other === null || !r.isSubtype(r.typeOf(other), TYPE_VARIABLE)) return 0;
    const decl = dispatchVirtual(r, TYPE_VARIABLE, 'getGenericDeclaration', [], GENERIC_DECLARATION, [other]), name = dispatchVirtual(r, TYPE_VARIABLE, 'getName', [], STRING, [other]);
    return tv(r, self).name === r.stringCharacters(name) && r.javaEquals(tv(r, self).decl, decl) ? 1 : 0;
  });
  def(TV, 'hashCode', '()I', (r, _m, [self]) => (r.javaHash(tv(r, self).decl) ^ r.javaHash(tv(r, self).name)) | 0);

  // WildcardTypeImpl
  const wt = (r, ref) => r.object(ref).wt;
  def(WT, 'getUpperBounds', `()[${TYPE}`, (r, _m, [self]) => array(r, TYPE, wt(r, self).upper.length ? [...wt(r, self).upper] : [r.classObject(OBJECT)]));
  def(WT, 'getLowerBounds', `()[${TYPE}`, (r, _m, [self]) => array(r, TYPE, [...wt(r, self).lower]));
  const wildcardText = (r, ref) => {
    const w = wt(r, ref), isObject = x => r.object(x).classType === OBJECT;
    if (w.lower.length) return '? super ' + typeNames(r, w.lower, ' & ');
    return w.upper.length && !(w.upper.length === 1 && isObject(w.upper[0])) ? '? extends ' + typeNames(r, w.upper, ' & ') : '?';
  };
  def(WT, 'toString', `()${STRING}`, (r, _m, [self]) => wildcardText(r, self)); def(WT, 'getTypeName', `()${STRING}`, (r, _m, [self]) => wildcardText(r, self));
  def(WT, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (other === null || !r.isSubtype(r.typeOf(other), WILDCARD)) return 0;
    const upper = r.array(dispatchVirtual(r, WILDCARD, 'getUpperBounds', [], `[${TYPE}`, [other])).elements, lower = r.array(dispatchVirtual(r, WILDCARD, 'getLowerBounds', [], `[${TYPE}`, [other])).elements;
    const mine = r.array(dispatchVirtual(r, WILDCARD, 'getUpperBounds', [], `[${TYPE}`, [self])).elements;
    return arrayEquals(r, mine, upper) && arrayEquals(r, wt(r, self).lower, lower) ? 1 : 0;
  });
  def(WT, 'hashCode', '()I', (r, _m, [self]) => (arrayHash(r, wt(r, self).lower) ^ arrayHash(r, wt(r, self).upper.length ? wt(r, self).upper : [r.classObject(OBJECT)])) | 0);

  // GenericArrayTypeImpl
  const gat = (r, ref) => r.object(ref).gat;
  def(GAT, 'getGenericComponentType', `()${TYPE}`, (r, _m, [self]) => gat(r, self).comp);
  def(GAT, 'toString', `()${STRING}`, (r, _m, [self]) => typeName(r, gat(r, self).comp) + '[]'); def(GAT, 'getTypeName', `()${STRING}`, (r, _m, [self]) => typeName(r, gat(r, self).comp) + '[]');
  def(GAT, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other !== null && r.isSubtype(r.typeOf(other), GENERIC_ARRAY) && r.javaEquals(gat(r, self).comp, dispatchVirtual(r, GENERIC_ARRAY, 'getGenericComponentType', [], TYPE, [other])) ? 1 : 0);
  def(GAT, 'hashCode', '()I', (r, _m, [self]) => r.javaHash(gat(r, self).comp));

  // ---- signatures of declarations -------------------------------------------------------------------------------------------------------------
  const signatureOf = annotations => { const a = annotations.find(x => x.type === SIGNATURE); return a ? a.values.get('value').values.join('') : null; };
  const classSignature = (r, typeName_) => {
    const cls = r.classes.get(typeName_); if (!cls) return null;
    cls.genericSignature ??= (() => { const text_ = signatureOf(r.classAnnotations(typeName_, 2)); return text_ === null ? false : parseClassSignature(text_); })();
    return cls.genericSignature || null;
  };
  const memberSignature = (r, member) => {
    const definition = member.field ?? member.method, annotations = definition.dex ? definition.dex.memberAnnotations(member, 2) : [], text_ = signatureOf(annotations);
    if (text_ === null) return null;
    return member.field ? parseFieldSignature(text_) : parseMethodSignature(text_);
  };
  const enclosingOf = (r, t) => { const info = r.classNesting(t); return info.declaringClass ?? info.enclosingClass ?? null; };

  /** The TypeVariable `name` as seen from `scope` ({ cls, member?, memberRef?, formals? }): method type parameters first, then the class and the classes enclosing it. */
  const typeVariables = new WeakMap();
  const variable = (r, name, scope) => {
    const table = typeVariables.get(r) ?? typeVariables.set(r, gcRoot(new Map())).get(r);
    const make = (key, formal, declScope, decl) => { if (!table.has(key)) { const ref = r.allocate(TV); r.object(ref).tv = { name, bounds: formal.bounds, scope: declScope, decl }; table.set(key, ref); } return table.get(key); };
    if (scope.memberFormals) { const formal = scope.memberFormals.find(f => f.name === name); if (formal) return make(`${scope.member.method.key}|${name}`, formal, scope, scope.memberRef); }
    for (let t = scope.cls, depth = 0; t && depth < 16; t = enclosingOf(r, t), depth++) {
      const formal = classSignature(r, t)?.formals.find(f => f.name === name);
      if (formal) return make(`${t}|${name}`, formal, { cls: t }, r.classObject(t));
    }
    return r.classObject(OBJECT);
  };
  const descriptorOf = node => node.k === 'prim' ? node.d : node.k === 'class' ? node.raw : node.k === 'array' ? '[' + descriptorOf(node.comp) : null;
  function materialize(r, node, scope) {
    switch (node.k) {
      case 'prim': return r.classObject(node.d);
      case 'tvar': return variable(r, node.name, scope);
      case 'class': {
        if (!node.args.length && (node.owner === null || !hasArguments(node.owner))) return r.classObject(node.raw);
        const ref = r.allocate(PT); r.object(ref).pt = { raw: r.classObject(node.raw), args: node.args.map(a => materialize(r, a, scope)), owner: node.owner ? materialize(r, node.owner, scope) : null }; return ref;
      }
      case 'array': {
        const comp = materialize(r, node.comp, scope);
        if (r.object(comp).classType !== undefined) return r.classObject('[' + r.object(comp).classType);
        const ref = r.allocate(GAT); r.object(ref).gat = { comp }; return ref;
      }
      case 'wild': { const ref = r.allocate(WT); r.object(ref).wt = { upper: node.upper.map(a => materialize(r, a, scope)), lower: node.lower.map(a => materialize(r, a, scope)) }; return ref; }
      default: throw new APKError('Unknown generic signature node');
    }
  }
  const hasArguments = node => node.args.length > 0 || (node.owner !== null && hasArguments(node.owner));

  // ---- java.lang.Class ----------------------------------------------------------------------------------------------------------------------
  const typeOfClass = (r, self) => r.object(self).classType;
  def(CLASS, 'getTypeParameters', `()[${TYPE_VARIABLE}`, (r, _m, [self]) => {
    const t = typeOfClass(r, self), sig = classSignature(r, t);
    return array(r, TYPE_VARIABLE, sig ? sig.formals.map(f => variable(r, f.name, { cls: t })) : []);
  });
  def(CLASS, 'getGenericSuperclass', `()${TYPE}`, (r, _m, [self]) => {
    const t = typeOfClass(r, self), sig = classSignature(r, t);
    if (sig) return materialize(r, sig.superclass, { cls: t });
    const parent = t.startsWith('[') || t.length === 1 || (r.classes.get(t)?.flags & 0x200) ? null : r.parent(t);
    return parent ? r.classObject(parent) : null;
  });
  def(CLASS, 'getGenericInterfaces', `()[${TYPE}`, (r, _m, [self]) => {
    const t = typeOfClass(r, self), sig = classSignature(r, t);
    return array(r, TYPE, sig ? sig.interfaces.map(i => materialize(r, i, { cls: t })) : (t.length === 1 ? [] : r.interfaces(t)).map(i => r.classObject(i)));
  });
  // Class.getEnumConstantsShared (package-private in libcore; EnumSet / EnumMap / Enum.valueOf use it): the enum's values(), null for a class that is not an enum.
  def(CLASS, 'getEnumConstantsShared', `()[${OBJECT}`, (r, _m, [self]) => {
    const t = typeOfClass(r, self);
    if (!(r.classes.get(t)?.flags & 0x4000) && platform.supports?.(`${t}->values()[${t}`)) return r.dispatch({ owner: t, name: 'values', parameters: [], result: `[${t}`, signature: `()[${t}` }, [], 'static');
    return dispatchVirtual(r, CLASS, 'getEnumConstants', [], `[${OBJECT}`, [self]);
  });
  def(CLASS, 'getTypeName', `()${STRING}`, (r, _m, [self]) => typeName(r, self));
  const publicMethods = (r, t) => {
    const found = new Map(), seen = new Set(), visit = owner => {
      if (!owner || seen.has(owner)) return; seen.add(owner);
      const cls = r.classes.get(owner);
      if (cls) for (const d of cls.methods.values()) if ((d.flags & 1) && !d.method.name.startsWith('<')) { const key = d.method.name + d.method.signature; if (!found.has(key)) found.set(key, d); }
      visit(r.parent(owner)); for (const i of r.interfaces(owner)) visit(i);
    };
    visit(t); return [...found.values()];
  };
  def(CLASS, 'getMethods', `()[${METHOD}`, (r, _m, [self]) => array(r, METHOD, publicMethods(r, typeOfClass(r, self)).map(d => r.reflectionObject('method', d))));

  // ---- Method / Constructor / Field -------------------------------------------------------------------------------------------------------
  const scopeOf = (r, ref) => {
    const member = r.object(ref).member, signature = member.method ? memberSignature(r, member) : null;
    return { signature, scope: { cls: member.method?.owner ?? member.field?.owner, member, memberRef: ref, memberFormals: signature?.formals ?? null } };
  };
  for (const owner of [METHOD, CONSTRUCTOR]) {
    def(owner, 'getGenericReturnType', `()${TYPE}`, (r, _m, [self]) => { const { signature, scope } = scopeOf(r, self); return signature ? materialize(r, signature.result, scope) : r.classObject(r.object(self).member.method.result); });
    def(owner, 'getGenericParameterTypes', `()[${TYPE}`, (r, _m, [self]) => {
      const { signature, scope } = scopeOf(r, self), declared = r.object(self).member.method.parameters;
      return array(r, TYPE, signature && signature.params.length === declared.length ? signature.params.map(p => materialize(r, p, scope)) : declared.map(p => r.classObject(p)));
    });
    def(owner, 'getTypeParameters', `()[${TYPE_VARIABLE}`, (r, _m, [self]) => { const { signature, scope } = scopeOf(r, self); return array(r, TYPE_VARIABLE, signature ? signature.formals.map(f => variable(r, f.name, scope)) : []); });
    def(owner, 'getParameterAnnotations', `()[[${ANNOTATION}`, (r, _m, [self]) => {
      const method = r.object(self).member.method, perParameter = parameterAnnotations(r, method);
      return array(r, `[${ANNOTATION}`, method.parameters.map((_p, i) => array(r, ANNOTATION, (perParameter[i] ?? []).map(a => r.annotationObject(a)))));
    });
    def(owner, 'isVarArgs', '()Z', (r, _m, [self]) => (r.object(self).member.flags & 0x80) ? 1 : 0);
  }
  def(METHOD, 'isDefault', '()Z', (r, _m, [self]) => { const { method, flags } = r.object(self).member, cls = r.classes.get(method.owner); return cls && (cls.flags & 0x200) && (flags & (0x400 | 1 | 8)) === 1 ? 1 : 0; });
  def(FIELD, 'isSynthetic', '()Z', (r, _m, [self]) => (r.object(self).member.flags & 0x1000) ? 1 : 0);
  def(FIELD, 'isEnumConstant', '()Z', (r, _m, [self]) => (r.object(self).member.flags & 0x4000) ? 1 : 0);
  def(FIELD, 'getGenericType', `()${TYPE}`, (r, _m, [self]) => {
    const member = r.object(self).member, signature = memberSignature(r, member);
    return signature ? materialize(r, signature, { cls: member.field.owner }) : r.classObject(member.field.type);
  });

  /** Runtime-visible annotations of each parameter of a DEX method (dex_file.h annotations_directory_item, parameter_annotations). */
  function parameterAnnotations(r, method) {
    const cls = r.classes.get(method.owner); if (!cls?.annotationsOffset || !method.dex) return [];
    const b = cls.dex.reader, p = cls.annotationsOffset, fields = b.u32(p + 4), methods = b.u32(p + 8), parameters = b.u32(p + 12);
    for (let i = 0, at = p + 16 + fields * 8 + methods * 8; i < parameters; i++, at += 8) {
      if (b.u32(at) !== method.index) continue;
      const list = b.u32(at + 4), count = b.u32(list); return Array.from({ length: count }, (_x, n) => cls.dex.annotationSet(b.u32(list + 4 + n * 4)));
    }
    return [];
  }

  // ---- java.lang.reflect.Proxy --------------------------------------------------------------------------------------------------------------
  type(PROXY, OBJECT, [], { allocatable: true }); type(INVOCATION_HANDLER, OBJECT); registry.interfaces.set(INVOCATION_HANDLER, []);
  type(UNDECLARED, 'Ljava/lang/RuntimeException;', [], { allocatable: true });
  const proxyClasses = new WeakMap();
  def(PROXY, 'newProxyInstance', `(Ljava/lang/ClassLoader;[${CLASS}${INVOCATION_HANDLER})${OBJECT}`, (r, _m, [, interfaces, handler]) => {
    if (handler === null) r.throwJava('Ljava/lang/NullPointerException;', 'h == null');
    const types = r.array(interfaces).elements.map(c => { if (c === null) r.throwJava('Ljava/lang/NullPointerException;', null); return r.object(c).classType; });
    for (const t of types) if (!(r.classes.get(t)?.flags & 0x200) && !(r.interfaces(t).length || ['Ljava/lang/Runnable;', 'Ljava/util/concurrent/Callable;'].includes(t))) {
      const known = r.classes.get(t); if (known || t.length === 1 || t.startsWith('[')) r.throwJava('Ljava/lang/IllegalArgumentException;', `${r.className(t, 'binary')} is not an interface`);
    }
    const table = proxyClasses.get(r) ?? proxyClasses.set(r, gcRoot(new Map())).get(r), key = types.join(','); let name = table.get(key);
    if (!name) { name = `L$Proxy${table.size};`; table.set(key, name); type(name, PROXY, types, { allocatable: true }); }
    const ref = r.allocate(name); const o = r.object(ref); o.proxyHandler = handler; o.proxyInterfaces = types; return ref;
  }, { static: true });
  def(PROXY, 'isProxyClass', `(${CLASS})Z`, (r, _m, [c]) => (proxyClasses.get(r) && [...proxyClasses.get(r).values()].includes(r.object(c).classType)) ? 1 : 0, { static: true });
  def(PROXY, 'getInvocationHandler', `(${OBJECT})${INVOCATION_HANDLER}`, (r, _m, [proxy]) => { const h = proxy === null ? null : r.object(proxy).proxyHandler; if (h === undefined || h === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'not a proxy instance'); return h; }, { static: true });
  for (const [name, signature] of [['hashCode', '()I'], ['equals', `(${OBJECT})Z`], ['toString', `()${STRING}`]]) def(PROXY, name, signature, (r, m, args) => invokeProxy(r, { owner: OBJECT, name, parameters: m.parameters ?? [], result: signature.slice(signature.indexOf(')') + 1), signature }, args));
  def(UNDECLARED, 'getUndeclaredThrowable', '()Ljava/lang/Throwable;', (r, _m, [self]) => r.object(self).cause ?? null);
  def(UNDECLARED, 'getCause', '()Ljava/lang/Throwable;', (r, _m, [self]) => r.object(self).cause ?? null);

  /** Methods a Proxy forwards to its handler: everything but Object's final methods. */
  const forwarded = method => !(['getClass', 'notify', 'notifyAll', 'wait'].includes(method.name));
  function invokeProxy(r, method, args) {
    const self = args[0], proxy = r.object(self), handler = proxy.proxyHandler;
    const owner = ['hashCode', 'equals', 'toString'].includes(method.name) && method.owner === OBJECT ? OBJECT : method.owner;
    let member = null;
    try { member = owner === OBJECT ? null : r.reflectionLookup(owner, 'method', method.name, method.parameters, false); } catch { member = null; }
    const reflected = r.reflectionObject('method', member ?? { method: { owner, name: method.name, parameters: method.parameters, result: method.result, signature: method.signature, key: `${owner}->${method.name}${method.signature}` }, flags: 1 });
    const boxed = method.parameters.length ? array(r, OBJECT, method.parameters.map((t, i) => r.boxPrimitive(t, args[1 + i + method.parameters.slice(0, i).filter(x => x === 'J' || x === 'D').length]))) : null;
    let result;
    try { result = dispatchVirtual(r, INVOCATION_HANDLER, 'invoke', [OBJECT, METHOD, `[${OBJECT}`], OBJECT, [handler, self, reflected, boxed]); }
    catch (error) {
      const thrown = error?.value;
      if (thrown && !r.isSubtype(r.typeOf(thrown), 'Ljava/lang/RuntimeException;') && !r.isSubtype(r.typeOf(thrown), 'Ljava/lang/Error;')) {
        const throwsAnnotation = member?.method?.dex?.memberAnnotations(member, 2).find(a => a.type === 'Ldalvik/annotation/Throws;'), declared = throwsAnnotation ? throwsAnnotation.values.get('value').values.map(v => v.value) : [];
        if (!declared.some(d => r.isSubtype(r.typeOf(thrown), d))) {
          const wrapper = r.makeObject(UNDECLARED), w = r.object(wrapper); w.message = null; w.cause = thrown; w.causeInitialized = true; w.stack = r.captureStack();
          r.throwJavaReference(wrapper, null);
        }
      }
      throw error;
    }
    if (method.result === 'V') return undefined;
    if (method.result.length === 1) { if (result === null) r.throwJava('Ljava/lang/NullPointerException;', `null returned from invocation handler for primitive ${method.result}`); return r.unboxReflection(result, method.result); }
    if (result !== null && !r.isSubtype(r.typeOf(result), method.result)) r.throwJava('Ljava/lang/ClassCastException;', `${r.className(r.typeOf(result), 'binary')} cannot be cast to ${r.className(method.result, 'binary')}`);
    return result;
  }
  return { ...registry, interfaces: registry.interfacesOf, invokeProxy, forwarded };
}
