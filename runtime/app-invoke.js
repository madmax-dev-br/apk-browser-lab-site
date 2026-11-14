// The app's own methods for a page plugin (docs/PLUGINS.md "Chamar um método do app"): listMethods reads the methods a class declares and inherits from the DEX (nothing
// runs), invokeAppMethod calls one on the VM's main thread, as the Worker's 'invoke-method' operation (src/apk-worker.js), between events, like a click. The method is the
// app's own bytecode, run faithfully through the interpreter (virtual dispatch from the receiver's class, so an override wins); nothing of the app is replaced or skipped.
// Arguments are JSON values converted by the declared parameter types; an object argument is a handle of the plugin queries (src/plugin-queries.js) checked against the
// parameter type. A Java exception the method throws is answered as { exception } (the snapshot after the call still goes to the page). Framework classes the lab implements
// itself (android.app.Activity, java.lang.Integer, android.widget.TextView, ...) have no DEX to read: they are not listed, and a call of one of their methods names it by its
// JVM signature, which the runtime then dispatches like any call site of the app would. No process.*.
import { PluginQueryError, parseHandle, handleOf, typeName, dotted, createHeapReader, classDescriptor } from './plugin-queries.js?v=a104526a388b';
import { parseSignature, floatBits, doubleBits } from './host-contract.js?v=a104526a388b';

export const INVOKE_LIMITS = Object.freeze({ methods: 200, maxMethods: 2000, args: 32, string: 100_000 });
const ACC = { PUBLIC: 0x1, PRIVATE: 0x2, PROTECTED: 0x4, STATIC: 0x8, BRIDGE: 0x40, ABSTRACT: 0x400, SYNTHETIC: 0x1000, CONSTRUCTOR: 0x10000 };
const CONTINUATION = 'Lkotlin/coroutines/Continuation;';
const BOXES = { 'Ljava/lang/Integer;': 'I', 'Ljava/lang/Long;': 'J', 'Ljava/lang/Short;': 'S', 'Ljava/lang/Byte;': 'B', 'Ljava/lang/Character;': 'C', 'Ljava/lang/Boolean;': 'Z', 'Ljava/lang/Float;': 'F', 'Ljava/lang/Double;': 'D' };
const fail = (code, message) => new PluginQueryError(code, message);
const SIGNATURE = /^\((\[*(?:[ZBCSIJFD]|L[^;()\s]+;))*\)(V|\[*(?:[ZBCSIJFD]|L[^;()\s]+;))$/;

function classOf(runtime, type) { try { return runtime.classes?.get?.(type) ?? null; } catch { return null; } }
const isBoot = (runtime, type) => { try { return !!runtime.dex?.bootClasses?.has?.(type); } catch { return false; } };
/** The object a handle names: { ref, type }. */
function receiverOf(runtime, handle) {
  const id = parseHandle(runtime, handle), rec = runtime.heap?.get?.(id);
  if (!rec) throw fail('collected', `objeto coletado: ${handle} foi liberado pelo coletor de lixo da VM (o app não o referencia mais)`);
  return { ref: { ref: rec.id ?? id }, type: rec.type };
}
/** The classes from `type` up its superclasses: [{ type, cls }] (classes the DEX of the app or of the framework define); `out.hosted`: the first one the lab implements itself. */
function chain(runtime, type, { inherited = true } = {}) {
  const out = []; let current = type; out.hosted = null;
  for (let depth = 0; current && depth < 64; depth++) {
    const cls = classOf(runtime, current); if (!cls) { out.hosted = current; break; }
    out.push({ type: current, cls, boot: isBoot(runtime, current) });
    if (inherited === false) break;
    current = cls.superclass ?? null;
  }
  return out;
}
const visibility = flags => flags & ACC.PUBLIC ? 'public' : flags & ACC.PRIVATE ? 'private' : flags & ACC.PROTECTED ? 'protected' : 'package';
function describeMethod(entry, declaredIn) {
  const m = entry.method, flags = entry.flags;
  return { name: m.name, signature: `(${m.parameters.join('')})${m.result}`, parameters: m.parameters.map(typeName), returns: typeName(m.result), static: !!(flags & ACC.STATIC), visibility: visibility(flags),
    declaredIn: dotted(declaredIn), abstract: !!(flags & ACC.ABSTRACT) || !entry.code, suspend: m.parameters.at(-1) === CONTINUATION };
}
const matcher = match => {
  if (match === undefined || match === null || match === '') return () => true;
  const text = String(match).slice(0, 200), regex = /^\/(.+)\/([a-z]*)$/.exec(text);
  if (regex) { let re; try { re = new RegExp(regex[1], regex[2].replace(/[^imsu]/g, '')); } catch { throw fail('bad-args', `Expressão regular inválida: ${text}`); } return name => re.test(name); }
  const lower = text.toLowerCase(); return name => name.toLowerCase().includes(lower);
};
/** Where a listing or a call starts: a live object (handle) or a class (className; one the lab implements itself only for a call by signature). -> { type, receiver | null }. */
function startOf(runtime, { handle, className, signature = null }, { call = false } = {}) {
  if (className !== undefined && className !== null && className !== '') {
    const type = classDescriptor(className);
    if (!classOf(runtime, type) && !(call && signature)) throw fail('no-class', `Classe não encontrada nos DEX: ${dotted(type)}${call ? ' (uma classe do framework que o lab implementa é chamada com { signature })' : ''}`);
    return { type, receiver: null };
  }
  if (!handle) throw fail('bad-args', 'Passe um handle (de lab.viewModels(), lab.instances(), ...) ou { static: "pacote.Classe" }.');
  const receiver = receiverOf(runtime, handle); return { type: receiver.type, receiver };
}

/**
 * The methods of a class and of its superclasses, most derived first, an override listed once: { className, methods, more }. Options: match (part of the name or /regex/),
 * parameters (the count), static (true / false), inherited (true: the app's classes up the chain, the default; 'all': the framework's too; false: only the class itself),
 * synthetic (compiler-made methods, off by default), limit.
 */
export function listMethods(runtime, args = {}) {
  if (!runtime) throw fail('no-apk', 'Nenhum APK em execução.');
  const { type } = startOf(runtime, args), named = matcher(args.match), limit = Math.max(1, Math.min(INVOKE_LIMITS.maxMethods, Math.floor(Number(args.limit) || INVOKE_LIMITS.methods)));
  const seen = new Set(), methods = []; let more = 0;
  const classes = chain(runtime, type, { inherited: args.inherited === false ? false : true });
  for (const { type: owner, cls, boot } of classes) {
    if (boot && args.inherited !== 'all' && owner !== type) continue;
    for (const entry of cls.methods.values()) {
      const m = entry.method, key = m.name + `(${m.parameters.join('')})${m.result}`;
      if (m.name === '<clinit>' || m.name === '<init>' || seen.has(key)) continue; seen.add(key);
      if (!args.synthetic && entry.flags & (ACC.SYNTHETIC | ACC.BRIDGE)) continue;
      if (args.static === true && !(entry.flags & ACC.STATIC)) continue; if (args.static === false && entry.flags & ACC.STATIC) continue;
      if (Number.isFinite(args.parameters) && m.parameters.length !== args.parameters) continue;
      if (!named(m.name)) continue;
      if (methods.length >= limit) { more++; continue; }
      methods.push(describeMethod(entry, owner));
    }
  }
  // a superclass the lab implements itself (android.app.Activity, ...): its methods exist but have no DEX to list; they are called with { signature }
  return { className: dotted(type), methods, more, ...(classes.hosted && classes.hosted !== type ? { labImplemented: dotted(classes.hosted) } : classes.hosted ? { labImplemented: dotted(type) } : {}) };
}

/** The method `name` of `type` or of a superclass, chosen by signature, or by the count of arguments when only one has it. -> { entry, owner }. */
function resolveMethod(runtime, type, name, signature, count, receiver) {
  const candidates = [], seen = new Set(), classes = chain(runtime, type);
  for (const { type: owner, cls } of classes) for (const entry of cls.methods.values()) {
    const m = entry.method, sig = `(${m.parameters.join('')})${m.result}`; if (m.name !== name || seen.has(sig)) continue; seen.add(sig);
    if (!(entry.flags & (ACC.SYNTHETIC | ACC.BRIDGE)) || signature) candidates.push({ entry, owner, sig });
  }
  const label = `${dotted(type)}.${name}`, wanted = signature ? String(signature).replace(/\s+/g, '') : null;
  if (wanted) {
    const found = candidates.find(item => item.sig === wanted || item.sig.startsWith(wanted) && wanted.endsWith(')'));
    if (found) return found;
    // a method of a class the lab implements itself (the receiver's superclass, or a framework class with no DEX): dispatched by its signature, as an app call site would
    if (classes.hosted && !candidates.length && SIGNATURE.test(wanted)) { const { parameters, result } = parseSignature(wanted); return { entry: { method: { owner: type, name, parameters, result }, flags: receiver ? 0 : ACC.STATIC, code: null }, owner: type, sig: wanted, hosted: true }; }
    if (!SIGNATURE.test(wanted)) throw fail('bad-args', `Assinatura JVM inválida: ${wanted.slice(0, 120)} (exemplo: (ILjava/lang/String;)V)`);
    throw fail('no-method', `${label} não tem a assinatura ${wanted}${candidates.length ? `; há: ${candidates.map(item => item.sig).join(', ')}` : ''}`);
  }
  if (!candidates.length) throw fail('no-method', `Método não encontrado: ${label} (use lab.methods para ver os que existem${classes.hosted ? `; um método de ${dotted(classes.hosted)}, que o lab implementa, é chamado com { signature }` : ''}).`);
  const byCount = candidates.filter(item => item.entry.method.parameters.length === count);
  if (byCount.length === 1) return byCount[0];
  if (!byCount.length) throw fail('bad-args', `${label} espera ${[...new Set(candidates.map(item => item.entry.method.parameters.length))].join(' ou ')} argumento(s), não ${count}: ${candidates.map(item => item.sig).join(', ')}`);
  throw fail('ambiguous', `${label} tem ${byCount.length} versões com ${count} argumento(s): passe { signature } (${byCount.map(item => item.sig).join(', ')}).`);
}

/** One JSON argument as the VM value of a parameter `type`. */
function argument(runtime, type, value, index) {
  const where = `argumento ${index + 1} (${typeName(type)})`, bad = what => fail('bad-args', `${where}: ${what}`);
  const integer = (min, max) => { const n = typeof value === 'boolean' ? Number(value) : Number(value); if (!Number.isInteger(n) || n < min || n > max) throw bad(`esperado um inteiro entre ${min} e ${max}`); return n; };
  switch (type) {
    case 'Z': if (typeof value !== 'boolean' && value !== 0 && value !== 1) throw bad('esperado true ou false'); return value ? 1 : 0;
    case 'B': return integer(-128, 127);
    case 'S': return integer(-32768, 32767);
    case 'I': return integer(-2147483648, 2147483647);
    case 'C': if (typeof value === 'string' && value.length === 1) return value.charCodeAt(0); return integer(0, 65535);
    case 'J': {
      const raw = value && typeof value === 'object' && value.long !== undefined ? value.long : value;
      if (typeof raw === 'number' && !Number.isSafeInteger(raw)) throw bad('um long além de 2^53 vai como texto ou { long: "…" }');
      try { const big = BigInt(raw); if (big < -(2n ** 63n) || big >= 2n ** 63n) throw new RangeError(); return big; } catch { throw bad('esperado um inteiro (long)'); }
    }
    case 'F': if (typeof value !== 'number') throw bad('esperado um número'); return floatBits(value);
    case 'D': if (typeof value !== 'number') throw bad('esperado um número'); return doubleBits(value);
  }
  if (value === null || value === undefined) return null;
  if (type === 'Ljava/lang/String;' || type === 'Ljava/lang/CharSequence;' || (type === 'Ljava/lang/Object;' && typeof value === 'string')) {
    if (typeof value !== 'string') throw bad('esperado um texto'); if (value.length > INVOKE_LIMITS.string) throw bad(`texto com mais de ${INVOKE_LIMITS.string} caracteres`); return value;
  }
  const box = BOXES[type] ?? (type === 'Ljava/lang/Object;' || type === 'Ljava/lang/Number;' ? (typeof value === 'boolean' ? 'Z' : typeof value === 'number' ? (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? 'I' : 'D') : null) : null);
  if (box && (typeof value === 'number' || typeof value === 'boolean' || (box === 'J' && typeof value === 'object' && value.long !== undefined) || (box === 'C' && typeof value === 'string'))) return runtime.boxPrimitive(box, argument(runtime, box, value, index));
  const handle = typeof value === 'string' ? value : value && typeof value === 'object' && typeof value.handle === 'string' ? value.handle : null;
  if (!handle) throw bad(type.startsWith('[') ? 'arrays não são aceitos aqui' : 'esperado um handle (de lab.viewModels(), lab.instances(), lab.field(...).$handle) ou null');
  const object = receiverOf(runtime, handle);
  if (!runtime.isSubtype(object.type, type)) throw bad(`o objeto ${handle} é ${typeName(object.type)}`);
  return object.ref;
}

/**
 * Calls a method of the app: { handle | className, method, signature?, args } -> { value (JSON view, see docs/PLUGINS.md "Valores"), returns, method, static, ms } or
 * { exception: { type, message, stack, cause }, method, ms } when the method threw. Runs on the VM's main thread (the caller is the Worker's operation, between events).
 */
export function invokeAppMethod(runtime, args = {}, { now = () => performance.now() } = {}) {
  if (!runtime) throw fail('no-apk', 'Nenhum APK em execução.');
  const name = String(args.method ?? '').trim(); if (!name || name.length > 300) throw fail('bad-args', 'Passe o nome do método.');
  if (name === '<init>' || name === '<clinit>') throw fail('bad-args', 'Construtores e inicializadores de classe não são chamados por aqui.');
  const values = Array.isArray(args.args) ? args.args : []; if (values.length > INVOKE_LIMITS.args) throw fail('bad-args', `No máximo ${INVOKE_LIMITS.args} argumentos.`);
  const start = startOf(runtime, args, { call: true }), { entry, owner } = resolveMethod(runtime, start.type, name, args.signature ?? null, values.length, start.receiver);
  const m = entry.method, isStatic = !!(entry.flags & ACC.STATIC), label = `${dotted(owner)}.${m.name}(${m.parameters.map(typeName).join(', ')})`;
  if (!isStatic && !start.receiver) throw fail('bad-args', `${label} é de instância: passe o handle de um objeto, não a classe.`);
  if (m.parameters.at(-1) === CONTINUATION) throw fail('unsupported', `${label} é uma função suspend do Kotlin: chame a função que a inicia (por exemplo a do ViewModel que faz o launch).`);
  if (m.parameters.length !== values.length) throw fail('bad-args', `${label} espera ${m.parameters.length} argumento(s).`);
  const converted = m.parameters.map((type, index) => argument(runtime, type, values[index], index));
  const method = { owner, name: m.name, parameters: m.parameters, result: m.result, signature: `(${m.parameters.join('')})${m.result}` };
  const mode = isStatic ? 'static' : entry.flags & ACC.PRIVATE ? 'direct' : 'virtual';
  const words = isStatic ? runtime.argumentWords(m.parameters, converted) : runtime.argumentWords(m.parameters, converted, { receiver: start.receiver.ref });
  runtime.record?.(`PLUGIN invoke ${label}`);
  const began = now();
  let result;
  try { result = runtime.dispatch(method, words, mode); }
  catch (error) {
    if (error?.name !== 'JavaException' || error.value === undefined) throw error;
    const thrown = runtime.describeThrowable(error.value);
    return { exception: { type: thrown.type, message: thrown.message, stack: thrown.stack, cause: thrown.cause }, method: label, static: isStatic, ms: Math.round(now() - began) };
  }
  const ms = Math.round(now() - began);
  if (m.result === 'V') return { value: null, returns: 'void', method: label, static: isStatic, ms };
  const view = createHeapReader(runtime).view(result, m.result, { depth: 1, ...(args.options ?? {}) });
  if (view.truncated && view.value && typeof view.value === 'object') view.value.$truncated = true;
  return { value: view.value, returns: typeName(m.result), method: label, static: isStatic, ms, ...(result && typeof result === 'object' && typeof result.ref === 'number' ? { handle: handleOf(runtime, result.ref) } : {}) };
}
