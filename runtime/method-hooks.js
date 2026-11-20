// Plugin method changes (lab.hook, docs/PLUGINS.md "Changing the app's methods"; CLAUDE.md, "method changes chosen by the user"): the Worker side of the three levels a plugin
// may apply to one of the app's methods, all in the registry of src/method-overrides.js, where the page's "Method returns" rows also live:
//   1. a fixed outcome: { returns: value } (the method's body does not run; the value is checked against the return type as the page's rows are) or { throws: 'pkg.Type', message };
//   2. observed calls: { observe: true } -- the body runs unchanged; each call is recorded (receiver, arguments, value or exception, thread, ms) in the plugin Values format
//      (src/plugin-queries.js) and delivered to the page in batches (drainHookCalls), within a budget of calls per second set by Plugin power (src/plugin-power.js); calls past
//      the budget are counted as not delivered (`dropped`), never slowed down or changed;
//   3. a replaced body: { smali: '.registers N ...' } -- assembled and verified by src/smali-assembler.js against the method's signature and the running VM's classes, written
//      as a DEX file of its own (one method id, one code item) and run in place of the body by both engines (the JavaScript interpreter decodes it from that DEX; the
//      WebAssembly core links a twin record of the method over it, vmcore/js/host-bridge.js hookBodyInfo). Removing the hook brings the original code back exactly.
// The method is named in smali form (`Lpkg/Class;->name(Params)Ret`, also the Java form of src/method-overrides.js) or by { className, name, signature } as lab.invoke
// chooses overloads; the change applies to the RESOLVED definition (the class that declares the body: an override in a subclass is a different method).
// What is refused, explicitly (code 'unsupported', saying why): native methods (their body is native code; protected native libraries stay untouched, src/protected-native.js),
// abstract methods, static initializers, framework methods the lab implements in JavaScript (no DEX: nothing to hook), and a smali body for a framework method (levels 1
// and 2 only, where the lab runs the AOSP original from DEX).
// Runs in the Worker and in Node tests: no DOM, no process.*.
import { APKRuntime, DexFile, SHIMS, JavaException } from './apk-runtime.js?v=e5138148cfef';
import { assembleSmali, SmaliError } from './smali-assembler.js?v=e5138148cfef';
import { parseMethodSpec, parseReturnValue, smaliTypeToJava, hookRegistry, updateHooks, hookOn, hookDetail, HOOK_KINDS } from './method-overrides.js?v=e5138148cfef';
import { createHeapReader, classDescriptor, dotted, typeName } from './plugin-queries.js?v=e5138148cfef';

export const HOOK_LIMITS = Object.freeze({ hooks: 200, smaliChars: 200_000, message: 2000, maxPending: 2000, maxString: 2000, maxItems: 50, depth: 2 });
const ACC_STATIC = 0x8, ACC_NATIVE = 0x100, ACC_ABSTRACT = 0x400, ACC_INTERFACE = 0x200;
export class HookError extends Error { constructor(code, message, errors = null) { super(message); this.name = 'HookError'; this.code = code; if (errors) this.errors = errors; } }
const fail = (code, message, errors) => new HookError(code, message, errors);
const OBJECT_METHODS = new Set(['<init>()V', 'toString()Ljava/lang/String;', 'hashCode()I', 'equals(Ljava/lang/Object;)Z', 'getClass()Ljava/lang/Class;', 'notify()V', 'notifyAll()V', 'wait()V', 'wait(J)V', 'wait(JI)V', 'clone()Ljava/lang/Object;', 'finalize()V']);

// ---- which method -----------------------------------------------------------------------------------------------------------------------------------------------------
const isBoot = (rt, cls) => !!cls && !!rt.dex?.bootDexes?.has(cls.dex);
/** The class chain from `type` up: [{ type, cls }] while the classes have DEX; `hosted`: the first class the lab implements itself (no DEX), or null. */
function chain(rt, type) {
  const out = []; let current = type; out.hosted = null;
  for (let depth = 0; current && depth < 64; depth++) {
    let cls = null; try { cls = rt.classes.get(current) ?? null; } catch { cls = null; }
    if (!cls) { out.hosted = current; break; }
    out.push({ type: current, cls }); current = cls.superclass ?? null;
  }
  return out;
}
/**
 * The definition a spec names: { owner, name, signature, key, definition, declaredIn }. `spec.method`: smali or Java form; or `spec.className` + `spec.name` (+ `spec.signature`:
 * '(I)Z' or '(I)', when the name has overloads). The definition is looked up the class chain, as a call resolves it.
 */
export function resolveHookTarget(rt, spec) {
  let owner, name, wanted = null;
  if (typeof spec?.method === 'string' && spec.method.trim()) {
    const parsed = parseMethodSpec(spec.method);
    if (!parsed.ok) throw fail('bad-args', parsed.error);
    owner = parsed.owner; name = parsed.name; wanted = parsed.result === null ? `(${parsed.parameters.join('')})` : parsed.key.slice(parsed.key.indexOf('('));
  } else if (spec?.className) {
    try { owner = classDescriptor(String(spec.className)); } catch (error) { throw fail('bad-args', error?.message ?? String(error)); }
    name = String(spec.name ?? ''); if (!name) throw fail('bad-args', 'lab.hook({ className, name, signature }): the method name is missing');
    if (spec.signature !== undefined && spec.signature !== null && spec.signature !== '') { wanted = String(spec.signature).replace(/\s+/g, ''); if (!/^\([^)]*\)\S*$/.test(wanted)) throw fail('bad-args', `Invalid signature: ${wanted.slice(0, 120)} (example: (ILjava/lang/String;)Z)`); }
  } else throw fail('bad-args', "Name the method: lab.hook('Lpkg/Class;->name(Params)Ret', ...) or lab.hook({ className, name, signature }, ...)");
  const classes = chain(rt, owner), label = `${dotted(owner)}.${name}`;
  if (!classes.length) {
    if (APKRuntime.isPlatformSpace(owner) || rt.classResolvable?.(owner)) throw fail('unsupported', `${dotted(owner)} is implemented by the lab in JavaScript (it has no DEX code), so its methods cannot be changed: method changes apply to methods the VM runs from DEX (the app's, its libraries' and the framework's AOSP originals)`);
    throw fail('no-class', `Class not found in the DEX files: ${dotted(owner)}`);
  }
  const candidates = [], seen = new Set();
  for (const { type, cls } of classes) for (const [nameSig, definition] of cls.methods) {
    if (definition.method.name !== name) continue; const sig = nameSig.slice(name.length);
    if (seen.has(sig)) continue; seen.add(sig); candidates.push({ type, cls, sig, definition });
  }
  let found;
  if (wanted) {
    const matches = candidates.filter(item => item.sig === wanted || (wanted.endsWith(')') && item.sig.startsWith(wanted)));
    if (matches.length > 1) throw fail('ambiguous', `${label}${wanted} has ${matches.length} return types: write the full signature (${matches.map(item => item.sig).join(', ')})`);
    found = matches[0];
  } else if (candidates.length === 1) found = candidates[0];
  else if (candidates.length > 1) throw fail('ambiguous', `${label} has ${candidates.length} versions: pass the signature (${candidates.map(item => item.sig).join(', ')})`);
  if (!found) {
    const hosted = classes.hosted && classes.hosted !== 'Ljava/lang/Object;' ? classes.hosted : null;
    if (hosted) throw fail('unsupported', `${label}${wanted ?? ''} is not in the DEX of ${dotted(owner)} or its superclasses; ${dotted(hosted)}, above them, is implemented by the lab in JavaScript, so its methods cannot be changed`);
    throw fail('no-method', `Method not found: ${label}${wanted ?? ''}${candidates.length ? `; available: ${candidates.map(item => item.sig).join(', ')}` : ''}`);
  }
  const definition = found.definition, signature = found.sig, key = `${found.type}->${name}${signature}`;
  return { owner: found.type, name, signature, key, definition, declaredIn: found.type, cls: found.cls, framework: isBoot(rt, found.cls) };
}
/** Why the target cannot take a change of `kind`, or null. */
function refusal(rt, target, kind) {
  const { definition, name, key, cls } = target;
  if (name === '<clinit>') return 'a static initializer (<clinit>) cannot be changed: it runs once, when the class initializes';
  if (definition.flags & ACC_NATIVE) return `${key} is a native method: its body is native code (JNI or the lab's binding), so it cannot be changed; method changes apply to methods with DEX bytecode`;
  if (!definition.code || definition.flags & ACC_ABSTRACT) return `${key} is abstract: it has no body; change the implementation in the class that defines it`;
  if (target.framework) {
    if (kind === 'smali') return `${key} is a framework method (the AOSP original the lab runs from DEX): a smali body applies to the app's own methods; a fixed return or exception and observed calls are allowed here`;
    if ((cls.flags & ACC_INTERFACE) && (SHIMS.has(key) || rt.platform?.supports?.(key))) return `${key} is served by the lab's JavaScript implementation, not by its DEX body: it cannot be changed`;
  }
  return null;
}

// ---- the smali body ---------------------------------------------------------------------------------------------------------------------------------------------------
/** What the verifier asks about the running VM: classes, methods and fields resolve as a call or field access would (src/smali-assembler.js `resolver`). */
export function vmResolver(rt) {
  const classExists = type => { try { return rt.classes.has(type) || APKRuntime.isPlatformSpace(type) || !!rt.classResolvable?.(type); } catch { return false; } };
  const hostServes = key => SHIMS.has(key) || !!rt.skiaHost?.supports?.(key) || !!rt.platform?.supports?.(key);
  const inInterfaces = (type, nameSig, depth = 0) => {
    if (depth > 32) return false;
    for (const iface of (() => { try { return rt.interfaces(type) ?? []; } catch { return []; } })()) {
      const cls = rt.classes.get(iface); if (cls?.methods.has(nameSig) || hostServes(`${iface}->${nameSig}`) || inInterfaces(iface, nameSig, depth + 1)) return true;
    }
    return false;
  };
  return {
    classExists,
    method(owner, name, signature, kind = null) {
      if (owner[0] === '[') return OBJECT_METHODS.has(name + signature) ? null : `${owner}->${name}${signature}: arrays have only java.lang.Object's methods`;
      const nameSig = name + signature; let hosted = null;
      for (let type = owner, depth = 0; type && depth < 64; depth++) {
        const cls = rt.classes.get(type), definition = cls?.methods.get(nameSig);
        if (definition && kind !== null && (kind === 'static') !== !!(definition.flags & ACC_STATIC)) return `${type}->${nameSig} is ${definition.flags & ACC_STATIC ? 'static: call it with invoke-static' : 'an instance method: call it with invoke-virtual, invoke-direct or invoke-super'}`;
        if (cls) { if (definition || inInterfaces(type, nameSig)) return null; }
        else {
          hosted ??= type;
          if (hostServes(`${type}->${nameSig}`) || (type === 'Ljava/lang/Object;' && OBJECT_METHODS.has(nameSig)) || inInterfaces(type, nameSig)) return null;
          if (name === '<init>') break;
        }
        if (type === 'Ljava/lang/Object;') break;
        try { type = rt.parent(type); } catch { break; }
      }
      try { if (rt.findInterfaceDefault?.(owner, { owner, name, signature, nameSig })?.code) return null; } catch { /* no default */ }
      return `${owner}->${name}${signature} does not resolve: no class from ${dotted(owner)} up declares it${hosted && hosted !== 'Ljava/lang/Object;' ? `, and the lab's ${dotted(hosted)} does not implement it` : ''}`;
    },
    field(owner, name, type, isStatic) {
      for (let at = owner, depth = 0; at && depth < 64; depth++) {
        const cls = rt.classes.get(at);
        if (!cls) { if (at === 'Ljava/lang/Object;') break; return null; }   // java.lang.Object has no fields; another class the lab implements resolves its own at run time
        for (const entry of isStatic ? cls.staticFields : cls.fields) { const field = cls.dex.field(entry.index); if (field.name === name && field.type === type) return null; }
        if (isStatic) for (const iface of rt.interfaces(at) ?? []) { const c = rt.classes.get(iface); if (c?.staticFields.some(entry => { const f = c.dex.field(entry.index); return f.name === name && f.type === type; })) return null; }
        at = cls.superclass ?? null;
      }
      return `${owner}->${name}:${type} does not resolve: no ${isStatic ? 'static' : 'instance'} field ${name} of type ${type} in ${dotted(owner)} or its superclasses`;
    },
  };
}
/** Assembles `text` for the target: { method, code, units, registers, instructions, dex } (the hook DEX's method id and code item, as a DEX class definition carries them). */
export function smaliBody(rt, target, text, id) {
  if (typeof text !== 'string' || !text.trim()) throw fail('bad-args', 'smali: the body is empty');
  if (text.length > HOOK_LIMITS.smaliChars) throw fail('bad-args', `smali: the body has more than ${HOOK_LIMITS.smaliChars} characters`);
  const { definition } = target, isStatic = !!(definition.flags & ACC_STATIC);
  let out;
  try { out = assembleSmali(text, { owner: target.owner, name: target.name, parameters: definition.method.parameters, result: definition.method.result, isStatic }, { resolver: vmResolver(rt) }); }
  catch (error) { if (error instanceof SmaliError) throw fail('verify', error.message, error.errors); throw error; }
  const dex = new DexFile(out.bytes, { filename: `hook-${id}.dex`, internTable: rt.dex.internTable });
  const method = dex.method(out.selfMethodIndex), code = { registers: out.registers, incoming: out.ins, tries: out.tries, units: out.units.length, offset: out.codeOffset };
  if (method.key !== target.key) throw new Error(`hook DEX: method ${method.key} is not ${target.key}`);
  const body = { method, code, units: out.units.length, registers: out.registers, instructions: out.instructions, dex, def: { method, flags: definition.flags & ~(ACC_NATIVE | ACC_ABSTRACT), code } };
  dex.hookBody = body;   // the WebAssembly core runs it from a record of its own (vmcore/js/host-bridge.js hookBodyInfo)
  return body;
}

// ---- the fixed exception ----------------------------------------------------------------------------------------------------------------------------------------------
function exceptionType(rt, text) {
  const raw = String(text ?? '').trim(); if (!raw) throw fail('bad-args', "throws: name the exception class ('java.lang.IllegalStateException')");
  let type; try { type = raw.startsWith('L') && raw.endsWith(';') ? raw : classDescriptor(raw); } catch (error) { throw fail('bad-args', error?.message ?? String(error)); }
  if (!rt.classes.has(type) && !APKRuntime.isPlatformSpace(type) && !rt.classResolvable?.(type)) throw fail('no-class', `throws: class not found: ${dotted(type)}`);
  let throwable = false; try { throwable = rt.isSubtype(type, 'Ljava/lang/Throwable;'); } catch { throwable = false; }
  if (!throwable) throw fail('bad-args', `throws: ${dotted(type)} is not a Throwable`);
  const cls = rt.classes.get(type);
  if (cls && (cls.flags & (ACC_ABSTRACT | ACC_INTERFACE))) throw fail('bad-args', `throws: ${dotted(type)} is abstract`);
  return type;
}
/** The exception of a { throws } hook, made at each call: an app class runs its own constructor (String) or (); a framework class is made as the lab makes its own exceptions. */
function raiser(type, message) {
  return rt => {
    const cls = rt.classes.get(type);
    if (cls && !isBoot(rt, cls)) {
      const withMessage = cls.methods.get('<init>(Ljava/lang/String;)V'), bare = cls.methods.get('<init>()V');
      if (withMessage || bare) {
        const object = rt.makeObject(type), ref = { owner: type, name: '<init>', parameters: withMessage ? ['Ljava/lang/String;'] : [], result: 'V', signature: withMessage ? '(Ljava/lang/String;)V' : '()V' };
        rt.dispatch(ref, withMessage ? [object, message] : [object], 'direct');
        throw new JavaException(object, rt.object(object).message ?? null);   // what the constructor made of the message stays (a class may prefix it)
      }
    }
    rt.throwJava(type, message ?? null);
  };
}

// ---- observed calls -------------------------------------------------------------------------------------------------------------------------------------------------
/** Calls of observed methods delivered per second (all hooks together), by Plugin power level; the rest are counted as not delivered. src/plugin-power.js has the levels. */
export function setHookCallBudget(rt, perSecond) { const observer = observerOf(rt); observer.perSecond = Math.max(1, Math.floor(Number(perSecond) || 200)); return observer.perSecond; }
function observerOf(rt) {
  if (rt.methodHookObserver) return rt.methodHookObserver;
  const reader = createHeapReader(rt);
  const view = (value, type, hook) => { try { return reader.view(value, type, { depth: hook.depth, maxString: hook.maxString, maxItems: hook.maxItems, maxFields: 40, budgetMs: 2 }).value; } catch (error) { return { $error: String(error?.message ?? error).slice(0, 200) }; } };
  const observer = rt.methodHookObserver = {
    perSecond: 200, maxPending: HOOK_LIMITS.maxPending, pending: [], windowAt: -Infinity, windowCount: 0, dropped: 0, seq: 0, now: () => performance.now(),
    notify: () => rt.methodHookNotify?.(),   // the Worker's flush (one message per batch, src/apk-worker.js scheduleHookCalls)
    /** A call starts: null when the budget of this second is spent (counted as not delivered), else the record being filled. */
    begin(rt, hook, definition, args, mode) {
      const t = observer.now();
      if (t - observer.windowAt >= 1000) { observer.windowAt = t; observer.windowCount = 0; }
      if (observer.windowCount >= observer.perSecond || observer.pending.length >= observer.maxPending) { hook.dropped = (hook.dropped ?? 0) + 1; hook.droppedSince = (hook.droppedSince ?? 0) + 1; observer.dropped++; if (observer.dropped === 1) observer.notify(); return null; }
      observer.windowCount++;
      const method = definition.method, values = rt.compactArguments(method, args, mode), isStatic = mode === 'static', out = { seq: ++observer.seq, hook: hook.id, method: hook.key, owner: hook.owner.id };
      if (!isStatic) out.receiver = view(values[0], method.owner, hook);
      out.args = method.parameters.map((type, i) => view(values[i + (isStatic ? 0 : 1)], type, hook));
      out.thread = rt.thread?.name ?? 'main'; out.at = Math.round((rt.clock?.now?.() ?? 0) * 1000) / 1000; out.started = t; out.result = method.result; out.hookRef = hook;
      return out;
    },
    /** The call ended with `value` or `error` (a Java exception, or a lab failure): the record joins the batch the page receives next. */
    end(rt, call, value, error) {
      const hook = call.hookRef; delete call.hookRef;
      call.ms = Math.round((observer.now() - call.started) * 1000) / 1000; delete call.started;
      if (error) {
        const ref = error?.name === 'JavaException' ? error.value : null;
        let message = null; try { message = rt.object(ref)?.message ?? null; if (message !== null && typeof message !== 'string') message = rt.stringCharacters(message); } catch { message = null; }
        call.thrown = ref ? { $type: typeName(rt.typeOf?.(ref) ?? 'Ljava/lang/Throwable;'), message, $handle: view(ref, 'Ljava/lang/Object;', { depth: 0, maxString: 200, maxItems: 0 })?.$handle ?? null } : { lab: String(error?.message ?? error).slice(0, 500) };
      } else call.returned = call.result === 'V' ? null : view(value, call.result, hook);
      delete call.result;
      if (hook.droppedSince) { call.dropped = hook.droppedSince; hook.droppedSince = 0; }
      hook.delivered = (hook.delivered ?? 0) + 1;
      observer.pending.push(call);
      observer.notify?.();
    },
  };
  return observer;
}
/** The observed calls since the last drain, grouped by the plugin that owns their hooks: { batches: [{ owner, calls }], dropped } (dropped: calls not delivered since then), or null. */
export function drainHookCalls(rt) {
  const observer = rt.methodHookObserver; if (!observer || (!observer.pending.length && !observer.dropped)) return null;
  const byOwner = new Map(); for (const call of observer.pending) { let list = byOwner.get(call.owner); if (!list) byOwner.set(call.owner, list = []); list.push(call); }
  const out = { batches: [...byOwner].map(([owner, calls]) => ({ owner, calls })), dropped: observer.dropped };
  observer.pending = []; observer.dropped = 0;
  return out;
}

// ---- install / remove / list -------------------------------------------------------------------------------------------------------------------------------------------
const jsonReturn = (result, value) => {
  if (result === 'V') return '';
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return String(value);
  if (value && typeof value === 'object' && typeof value.long === 'string') return value.long;
  if (result === 'Ljava/lang/String;' && typeof value === 'string') return `"${value}"`;   // parseReturnValue takes the text between the outer quotes as it is
  if (result === 'C' && typeof value === 'string' && value.length === 1) return `'${value}'`;
  if ((result === 'F' || result === 'D') && typeof value === 'number' && !Number.isFinite(value)) return Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
  return String(value);
};
const bounded = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; };
/**
 * Installs one plugin change. `spec`: the method (see resolveHookTarget) and exactly one of { kind: 'returns', value } | { kind: 'throws', throws, message } | { kind: 'observe',
 * depth, maxString, maxItems } | { kind: 'smali', smali }; `persist` is the page's (it re-applies the change after a reload). `owner`: { id, name } of the plugin. `id`: the page's
 * id for the change (kept across reloads), else one is made. Returns the change as describeHook gives it; throws a HookError (`code`: bad-args, no-class, no-method,
 * ambiguous, unsupported, conflict, limit, verify (with `errors`: [{ line, message }])).
 */
export function installMethodHook(rt, spec, owner, { packageName = null, id = null } = {}) {
  if (!rt) throw fail('no-apk', 'No APK is running.');
  const kind = String(spec?.kind ?? '');
  if (!HOOK_KINDS.includes(kind)) throw fail('bad-args', `lab.hook: give exactly one of returns, throws, observe: true or smali (got ${kind || 'none'})`);
  const registry = hookRegistry(rt);
  if (registry.hooks.size >= HOOK_LIMITS.hooks) throw fail('limit', `At most ${HOOK_LIMITS.hooks} method changes at a time.`);
  const target = resolveHookTarget(rt, spec);
  const why = refusal(rt, target, kind); if (why) throw fail('unsupported', why);
  const hookId = id === null || id === undefined || id === '' ? `h${++registry.seq}` : String(id).slice(0, 80);
  const ownerRecord = { kind: 'plugin', id: String(owner?.id ?? ''), name: String(owner?.name ?? 'plugin').slice(0, 120) };
  const existing = hookOn(rt, target.key), replacing = existing && existing.owner.kind === 'plugin' && existing.owner.id === ownerRecord.id ? existing : null;
  if (existing && !replacing) throw fail('conflict', `${target.key} is already changed by ${existing.owner.kind === 'page' ? 'the page (Method returns)' : `plugin "${existing.owner.name}"`} (${existing.kind}${existing.owner.kind === 'plugin' ? `, ${existing.id}` : ''}): remove that change first`);
  const sameId = registry.hooks.get(hookId); if (sameId && sameId !== replacing && sameId.owner.id !== ownerRecord.id) throw fail('conflict', `id ${hookId} belongs to another change`);
  const hook = { id: hookId, key: target.key, kind, owner: ownerRecord, packageName, persist: spec.persist === true, framework: target.framework, declaredIn: target.declaredIn, hits: 0, dropped: 0, delivered: 0, createdAt: Date.now() };
  if (kind === 'returns') {
    const result = target.definition.method.result, value = parseReturnValue(result, jsonReturn(result, spec.value));
    if (!value.ok) throw fail('bad-args', `returns: ${value.error}`);
    Object.assign(hook, { result, value: value.value, display: value.display });
  } else if (kind === 'throws') {
    const type = exceptionType(rt, spec.throws), message = spec.message === undefined || spec.message === null ? null : String(spec.message).slice(0, HOOK_LIMITS.message);
    Object.assign(hook, { throwType: type, message, raise: raiser(type, message) });
  } else if (kind === 'observe') {
    Object.assign(hook, { depth: bounded(spec.depth, 0, 0, HOOK_LIMITS.depth), maxString: bounded(spec.maxString, 200, 0, HOOK_LIMITS.maxString), maxItems: bounded(spec.maxItems, 5, 0, HOOK_LIMITS.maxItems), droppedSince: 0 });
    observerOf(rt);
  } else hook.body = smaliBody(rt, target, spec.smali, hookId);
  const remove = []; if (replacing) remove.push(replacing.id); if (sameId && sameId !== replacing) remove.push(sameId.id);
  for (const old of remove.map(x => registry.hooks.get(x)).filter(Boolean)) rt.record(`UNHOOK ${old.id} ${old.key} (${old.hits} calls; replaced)`);
  rt.record(`HOOK ${hook.id} ${kind} ${hook.key} ${kind === 'observe' ? '' : hookDetail(hook) + ' '}by plugin "${ownerRecord.name}"${hook.framework ? ' [framework method]' : ''}${hook.persist ? ' [persist]' : ''}`);
  updateHooks(rt, { remove, add: [hook] });
  return describeHook(hook);
}
/** Removes one change (a plugin's, or a page row by its id `page:<key>`, which the page then drops from its list). Returns whether it existed. */
export function removeMethodHook(rt, id, { owner = null } = {}) {
  const registry = rt?.methodHookRegistry, hook = registry?.hooks.get(String(id)); if (!hook) return false;
  if (owner !== null && hook.owner.id !== String(owner)) throw fail('bad-args', `change ${hook.id} belongs to ${hook.owner.kind === 'page' ? 'the page' : `plugin "${hook.owner.name}"`}`);
  rt.record(`UNHOOK ${hook.id} ${hook.key} (${hook.hits} calls)`);
  updateHooks(rt, { remove: [hook.id] });
  if (hook.owner.kind === 'page' && rt.methodOverridesAll?.has(hook.key)) rt.methodOverridesAll.get(hook.key).enabled = false;
  return true;
}
/** Removes every change of a plugin (it stopped, or was removed): how many. */
export function removeMethodHooksOf(rt, ownerId) {
  const registry = rt?.methodHookRegistry; if (!registry) return 0;
  const ids = [...registry.hooks.values()].filter(hook => hook.owner.kind === 'plugin' && hook.owner.id === String(ownerId)).map(hook => hook.id);
  for (const id of ids) { const hook = registry.hooks.get(id); rt.record(`UNHOOK ${hook.id} ${hook.key} (${hook.hits} calls; plugin "${hook.owner.name}" stopped)`); }
  if (ids.length) updateHooks(rt, { remove: ids });
  return ids.length;
}
/** A change as the page, lab.hooks() and MCP see it. */
export function describeHook(hook) {
  const out = { id: hook.id, method: hook.key, kind: hook.kind, owner: hook.owner.kind, plugin: hook.owner.kind === 'plugin' ? { id: hook.owner.id, name: hook.owner.name } : null, hits: hook.hits,
    detail: hookDetail(hook), framework: !!hook.framework, persist: !!hook.persist, package: hook.packageName ?? null };
  if (hook.kind === 'returns') out.value = hook.display;
  if (hook.kind === 'throws') { out.throws = dotted(hook.throwType); out.message = hook.message; }
  if (hook.kind === 'observe') { out.dropped = hook.dropped ?? 0; out.delivered = hook.delivered ?? 0; }
  if (hook.kind === 'smali') out.smali = { registers: hook.body.registers, units: hook.body.units, instructions: hook.body.instructions };
  if (hook.declaredIn) out.declaredIn = dotted(hook.declaredIn);
  return out;
}
/** Every change of the registry (the page's rows and the plugins'), oldest first. */
export function listMethodHooks(rt) { return [...(rt?.methodHookRegistry?.hooks.values() ?? [])].map(describeHook); }
/** { count, calls, byKind } of the active changes, for the page's chip, lab_status and the report. */
export function hookTotals(rt) {
  const hooks = [...(rt?.methodHookRegistry?.hooks.values() ?? [])], byKind = {};
  for (const hook of hooks) byKind[hook.kind] = (byKind[hook.kind] ?? 0) + 1;
  return { count: hooks.length, calls: hooks.reduce((sum, hook) => sum + hook.hits, 0), byKind };
}
export { smaliTypeToJava };
