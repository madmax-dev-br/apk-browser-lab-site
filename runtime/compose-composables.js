// Which composable a restart group belongs to, and what its inputs were: the part of the recomposition counter (src/compose-recompositions.js) that reads the app's DEX and the VM's
// objects. Read-only, runs no app code, only used while counting is on; no DOM, no process.*.
//
// Which composable. A composable that can be skipped or restarted is a DEX method with a Composer parameter whose code calls Composer.startRestartGroup(int). restartableMethods()
// finds them in the method tables (no class is built that is not one of them), and the counter observes their entry: the method names the composable and the arguments are its
// inputs, the same on both engines. A composable lambda's group is started by Compose's ComposableLambdaImpl; its name is the class of the lambda it wraps.
// A group that was not composed while counting is named from the block its scope keeps to restart it, when it keeps one (RecomposeScopeImpl.block: the lambda passed to
// updateScope): the composable that block calls. Names are what the APK has: nothing is guessed, and a name that looks like a minifier's is marked obfuscated.
//
// Inputs. A composition's arguments are kept as a snapshot (values and object ids, never references): primitives, Strings and boxed values by value; an object by its class, its
// id and, to a bounded depth, the snapshot of its fields (an ArrayList, an Arrays.asList list or an array: its elements). Ids are never reused, so an equal id is the same instance.
import { debugInfoOf } from './debug-info.js?v=6e6d833f3663';

const COMPOSER = 'Landroidx/compose/runtime/Composer;', START = 'startRestartGroup', START_SIGNATURE = '(I)Landroidx/compose/runtime/Composer;';
const LAMBDA_IMPL = /^Landroidx\/compose\/runtime\/internal\/ComposableLambda(?:N)?Impl;$/;
export const MAX_DEPTH = 5, MAX_NODES_PER_INPUT = 128, MAX_ELEMENTS = 64;   // how far the content of an input is compared; beyond it the comparison says "unknown"
const INVOKES = new Set([0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78]);
const FUNCTION = /^Lkotlin\/jvm\/functions\/Function\w+;$/;

// The size of each opcode in code units (the disassembler's table is not loaded with the APK: tests/worker-code-lazy.test.mjs); tests/compose-recompositions.test.mjs compares the two.
const SIZES = new Uint8Array(256).fill(1);
for (const [from, to, size] of [[0x02, 0x02, 2], [0x05, 0x05, 2], [0x08, 0x08, 2], [0x03, 0x03, 3], [0x06, 0x06, 3], [0x09, 0x09, 3], [0x13, 0x13, 2], [0x15, 0x16, 2], [0x19, 0x1a, 2], [0x14, 0x14, 3], [0x17, 0x17, 3], [0x1b, 0x1b, 3], [0x18, 0x18, 5],
  [0x1c, 0x1c, 2], [0x1f, 0x20, 2], [0x22, 0x23, 2], [0x24, 0x26, 3], [0x29, 0x29, 2], [0x2a, 0x2c, 3], [0x2d, 0x3d, 2], [0x44, 0x6d, 2], [0x6e, 0x72, 3], [0x74, 0x78, 3], [0x90, 0xaf, 2], [0xd0, 0xe2, 2], [0xfa, 0xfb, 4], [0xfc, 0xfd, 3], [0xfe, 0xff, 2]]) SIZES.fill(size, from, to + 1);
/** The size in code units of the instruction (or switch / array payload) at `pc`. */
export function unitsAt(u, pc) {
  const op = u[pc] & 255, ident = op === 0 ? u[pc] >> 8 : 0;
  if (ident === 1) return (u[pc + 1] ?? 0) * 2 + 4;
  if (ident === 2) return (u[pc + 1] ?? 0) * 4 + 2;
  if (ident === 3) return Math.floor((((u[pc + 2] ?? 0) | ((u[pc + 3] ?? 0) << 16)) * (u[pc + 1] ?? 0) + 1) / 2) + 4;
  return SIZES[op];
}
const codeUnits = definition => { const view = definition.method.dex.reader.view, { offset, units } = definition.code; return Uint16Array.from({ length: units }, (_, i) => view.getUint16(offset + i * 2, true)); };
/** The method indices a code item invokes, in order. */
function invokedMethods(definition) {
  const out = [], u = codeUnits(definition);
  for (let pc = 0; pc < u.length; pc += unitsAt(u, pc)) if (INVOKES.has(u[pc] & 255)) out.push(u[pc + 1]);
  return out;
}
/** The app's restartable composables: Map(method key -> definition). */
export function restartableMethods(runtime) {
  const found = new Map(), boot = runtime.dex.bootDexes;
  for (const { dex } of [...runtime.dex.files, ...(runtime.dex.dynamicFiles ?? [])]) {
    if (boot?.has(dex)) continue;
    const starts = new Set(dex.methodsNamed(START).filter(method => method.signature === START_SIGNATURE).map(method => method.index)); if (!starts.size) continue;
    const composer = dex.types.indexOf(COMPOSER); if (composer < 0) continue;
    const reader = dex.reader, protos = new Set();
    for (let i = 0; i < dex.protos.length; i++) { const list = reader.u32(dex.protoIdsOffset + i * 12 + 8); if (list) { const n = reader.u32(list); for (let k = 0; k < n; k++) if (reader.u16(list + 4 + k * 2) === composer) { protos.add(i); break; } } }
    for (let i = 0; i < dex.methods.length; i++) {
      if (!protos.has(reader.u16(dex.methodIdsOffset + i * 8 + 2))) continue;
      const owner = dex.methodOwner(i); if (!dex.classes.has(owner)) continue;
      const method = dex.method(i), definition = runtime.classes.get(owner)?.methods.get(method.name + method.signature);
      if (!definition?.code || definition.method.dex !== dex) continue;
      if (invokedMethods(definition).some(index => starts.has(index))) found.set(definition.method.key, definition);
    }
  }
  return found;
}

// ---- names
const simple = type => { const name = type.replace(/^\[*L?|;$/g, '').replaceAll('/', '.'); return name.slice(name.lastIndexOf('.') + 1); };
/** A one- or two-letter name is what a minifier gives; a name of the source is shown as it is. */
export const looksObfuscated = name => /^[a-zA-Z]{1,2}\d{0,2}$/.test(name);
/** 'Text--4IGK_g' -> 'Text' (the suffix Kotlin gives a method with inline class parameters), 'access$Row' -> 'Row', 'Row$lambda$3$lambda$1' -> 'Row'. */
export const sourceName = method => { let name = method.replace(/^access\$/, ''); name = name.replace(/\$lambda[$-].*$/, '').replace(/\$default$/, ''); const dash = name.indexOf('-'); return dash > 0 ? name.slice(0, dash) : name; };
const library = type => type.startsWith('Landroidx/compose/') || type.startsWith('Landroidx/activity/compose/') || type.startsWith('Landroidx/navigation/compose/') || type.startsWith('Landroidx/lifecycle/');
/** The composable of a method: { key, name, kind: 'function', declaredIn, source, obfuscated, library }. */
export function composableOfMethod(method) {
  const name = sourceName(method.name), declaredIn = simple(method.owner);
  return { key: method.key, name, kind: 'function', declaredIn, source: 'method', detail: method.key, obfuscated: looksObfuscated(name), library: library(method.owner) };
}
/** The composable lambda of class `type`: the name of the composable it is written in and which lambda of it (the numbers of its class), as its class (or the method its body is in) says. */
export function composableOfLambda(runtime, type) {
  const name = simple(type), parts = name.split('$').filter(Boolean), number = text => /^-?\d+$/.test(text); let inside = null, which = '', detail = type, declaredIn = parts[0] ?? name;
  if (/ExternalSynthetic|^-?\$?\$Lambda/.test(name)) { const body = bodyOfLambda(runtime, type); if (body) { inside = sourceName(body.name); which = body.name.split(/\$lambda[$-]/).slice(1).join('.'); detail = body.key; declaredIn = simple(body.owner); } }
  else if (/^ComposableSingletons/.test(name) && parts.length > 1) { declaredIn = parts[1]; return { key: `lambda:${type}`, name: `lambda in ${declaredIn}`, kind: 'lambda', declaredIn, source: 'lambda class', detail, obfuscated: false, library: library(type) }; }
  else { const at = parts.findIndex((part, i) => i > 0 && !number(part) && !/^lambda/.test(part)); if (at > 0) { inside = parts[at]; which = parts.slice(at + 1).filter(number).join('.'); } }   // MainActivityKt$Screen$1$2 -> Screen, 1.2
  return { key: `lambda:${type}`, name: inside ? `${inside} › lambda${which ? ` ${which}` : ''}` : name, kind: 'lambda', declaredIn, source: 'lambda class', detail, obfuscated: looksObfuscated(inside ?? name), library: library(type) };
}
/** The method with the body of a D8 lambda class: the `X$lambda$n` method its invoke() reaches. */
function bodyOfLambda(runtime, type) {
  const cls = runtime.classes.get(type); if (!cls) return null;
  let next = [...cls.methods.values()].filter(definition => definition.code && definition.method.name === 'invoke');
  for (let hop = 0; hop < 3; hop++) {
    const targets = [];
    for (const definition of next) for (const index of invokedMethods(definition)) {
      const method = definition.method.dex.method(index); if (/\$lambda[$-]\d/.test(method.name) && !method.name.startsWith('$r8$')) return method;
      if (method.name.startsWith('$r8$lambda')) { const target = runtime.classes.get(method.owner)?.methods.get(method.name + method.signature); if (target?.code) targets.push(target); }
    }
    next = targets; if (!next.length) return null;
  }
  return null;
}
const isLambdaImpl = type => LAMBDA_IMPL.test(type);
const fieldOf = (record, suffix) => { for (const [key, value] of record.fields) if (key.includes(suffix)) return value; return undefined; };
/** The wrapped lambda of a ComposableLambdaImpl: a reference, or null. */
export const lambdaBlock = (runtime, ref) => fieldOf(runtime.vmObject(ref), '->_block:') ?? null;

/** The composable of a restart group that was not composed while counting, from the block its scope keeps; null when it keeps none or the block does not lead to one. */
export function composableOfScope(runtime, methods, scopeId) {
  const scope = runtime.heap.get(scopeId); if (!scope) return null;
  const block = fieldOf(scope, '->block:'); if (!block || block.ref === undefined) return null;
  const record = runtime.vmObject(block), known = blockTargets(runtime).get(record.type); let target = known;
  if (target === undefined) blockTargets(runtime).set(record.type, target = targetOfBlock(runtime, methods, record.type));
  if (!target) return null;
  if (!isLambdaImpl(target.owner)) return composableOfMethod(target);
  for (const [, value] of record.fields) if (value && value.ref !== undefined && isLambdaImpl(runtime.vmObject(value).type)) { const body = lambdaBlock(runtime, value); if (body?.ref !== undefined) return composableOfLambda(runtime, runtime.vmObject(body).type); }
  return null;
}
const targets = new WeakMap(), blockTargets = runtime => { let map = targets.get(runtime); if (!map) targets.set(runtime, map = new Map()); return map; };
function targetOfBlock(runtime, methods, type) {
  let next = [...(runtime.classes.get(type)?.methods.values() ?? [])].filter(definition => definition.code && definition.method.name === 'invoke'); const seen = new Set();
  for (let hop = 0; hop < 4 && next.length; hop++) {
    const deeper = [];
    for (const definition of next) for (const index of invokedMethods(definition)) {
      const method = definition.method.dex.method(index); if (methods.has(method.key)) return method;
      if (!method.signature.includes(COMPOSER) && !(method.owner === type && method.name === 'invoke')) continue;   // the bridge invoke(Object, Object) and the $lambda / $r8$lambda / access$ hops
      const target = runtime.classes.get(method.owner)?.methods.get(method.name + method.signature); if (target?.code && !seen.has(method.key)) { seen.add(method.key); deeper.push(target); }
    }
    next = deeper;
  }
  return null;
}

// ---- inputs
const BOXES = new Set(['Integer', 'Long', 'Short', 'Byte', 'Character', 'Boolean', 'Float', 'Double'].map(name => `Ljava/lang/${name};`));
const OPAQUE = /^L(?:android\/|java\/lang\/(?:Class|Thread|ClassLoader)|java\/util\/concurrent\/|kotlinx\/coroutines\/|androidx\/(?:lifecycle|activity|fragment|navigation)\/|androidx\/compose\/ui\/(?:node|platform)\/(?!\w+Element;)|androidx\/compose\/runtime\/(?!ProvidedValue;))/;   // compared by identity only: a state, a View, a ViewModel store ... is the same object or another one
const hash = text => { let a = 0xdeadbeef, b = 0x41c6ce57; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); } return (b >>> 0) * 4096 + (a >>> 20); };
const textValue = text => text.length <= 64 ? text : `${text.length}:${hash(text)}:${text.slice(0, 24)}`;
/** Snapshot node of one value: a value node { v } (a primitive, String, boxed value or null) or an object node { t: class, id, c: [[field, node]] | null (not looked into) }, to be expanded. */
function shallowNode(runtime, value, primitive) {
  if (primitive) return { v: typeof value === 'bigint' ? `${value}L` : value ?? 0 };
  if (value === null || value === undefined || value === 0) return { v: null };
  if (typeof value === 'string') return { v: `"${textValue(value)}` };
  const record = runtime.vmObject(value), type = record.type;
  if (type === 'Ljava/lang/String;') return { v: `"${textValue(runtime.javaString(value, type))}` };
  if (BOXES.has(type)) { const boxed = record.boxed ?? fieldOf(record, '->value:'); if (boxed !== undefined) return { v: `${type}${boxed}` }; }
  return { t: type, id: value.ref, c: null };
}
/** The fields of an object (an ArrayList, an Arrays.asList list or an array: its elements) as child nodes; [] for one that has none. */
function expand(runtime, node) {
  const record = runtime.heap.get(node.id), type = node.t; node.c = [];
  const elements = (array, size) => {
    const cells = array.cells ?? array.elements ?? [], count = size ?? cells.length, primitive = /^\[[ZBCSIJFD]$/.test(array.type); node.c.push(['size', { v: count }]); if (count > MAX_ELEMENTS) node.more = true;
    for (let i = 0; i < Math.min(count, MAX_ELEMENTS); i++) node.c.push([`[${i}]`, shallowNode(runtime, cells[i], primitive)]);
  };
  if (type[0] === '[') { elements(record, null); return; }
  if (type === 'Ljava/util/ArrayList;' || type === 'Ljava/util/Arrays$ArrayList;') {
    const array = fieldOf(record, type === 'Ljava/util/ArrayList;' ? '->elementData:' : '->a:');
    if (array?.ref !== undefined) { elements(runtime.vmObject(array), type === 'Ljava/util/ArrayList;' ? fieldOf(record, '->size:') : null); return; }
  }
  for (const [key, child] of record.fields) {
    if (key.startsWith('Lkotlin/jvm/internal/Lambda;->')) continue;   // the arity, the same for every instance
    const arrow = key.indexOf('->'), colon = key.indexOf(':', arrow), name = key.slice(arrow + 2, colon), type = key.slice(colon + 1);
    if (name !== 'modCount') node.c.push([name, shallowNode(runtime, child, type.length === 1)]);
  }
}
/** The node of a value with its content, breadth first so that a large part of it does not use up the limit before its siblings are looked into. */
function snapshotNode(runtime, value, primitive) {
  const root = shallowNode(runtime, value, primitive); let level = [root], left = MAX_NODES_PER_INPUT;
  for (let depth = 0; depth < MAX_DEPTH && level.length; depth++) {
    const next = [];
    for (const node of level) {
      if (node.t === undefined || OPAQUE.test(node.t)) continue;
      if (left <= 0) return root;
      expand(runtime, node); left -= 1 + node.c.length; for (const [, child] of node.c) if (child.t !== undefined) next.push(child);
    }
    level = next;
  }
  return root;
}
const isFunction = (runtime, type) => { const cls = runtime.classes.get(type); return cls?.superclass === 'Lkotlin/jvm/internal/Lambda;' || !!cls?.interfaces?.some(name => FUNCTION.test(name)); };
/** Whether an instance of `type` may be changed in place in a way its reader shows (a collection, a class of the app): the same instance is looked into again each time. */
const mutable = (runtime, type) => COLLECTION.test(type) || (isModel(type) && !isFunction(runtime, type));
function inputNode(runtime, value, primitive, previous) {
  if (!primitive && previous?.node.t !== undefined && value?.ref === previous.node.id && !mutable(runtime, previous.node.t)) return previous.node;   // the same instance: nothing to read again
  return snapshotNode(runtime, value, primitive);
}
/** The inputs of one entry: [{ name, type, node }], the parameters before the Composer (the receiver first) -- for a composable lambda, its parameters and what the lambda captures.
 * `previous`: the inputs of the composition before, whose nodes of unchanged instances are kept. */
export function snapshotInputs(runtime, definition, args, previous = null) {
  const { method } = definition, isStatic = (definition.flags & 8) !== 0, names = isLambdaImpl(method.owner) ? [] : debugInfoOf(definition)?.parameters ?? [], out = [];
  let at = 0, p = 0;
  if (!isStatic) {
    const receiver = args[at++]; p++;
    if (isLambdaImpl(method.owner)) { const block = lambdaBlock(runtime, receiver); out.push({ name: 'captured values', type: block?.ref !== undefined ? runtime.vmObject(block).type : null, lambda: true, node: inputNode(runtime, block, false, previous?.[0]) }); }
    else out.push({ name: 'this', type: method.owner, node: inputNode(runtime, receiver, false, previous?.[0]) });
  }
  for (let i = 0; i < method.parameters.length; i++, p++) {
    const type = method.parameters[i]; if (type === COMPOSER) break;
    const value = args[at]; at += type === 'J' || type === 'D' ? 2 : 1;
    out.push({ name: names[p]?.name?.replace(/^\$this\$.*/, 'receiver') || `parameter ${i + 1}`, type, node: inputNode(runtime, value, type.length === 1, previous?.[out.length]) });
  }
  return out;
}
/** The argument word of the Composer. */
export function composerArgument(definition, args) {
  let at = (definition.flags & 8) !== 0 ? 0 : 1;
  for (const type of definition.method.parameters) { if (type === COMPOSER) return args[at]; at += type === 'J' || type === 'D' ? 2 : 1; }
  return null;
}
const COLLECTION = /^(?:\[|Ljava\/util\/|Lkotlin\/collections\/|Lkotlinx\/collections\/|Landroidx\/collection\/)/;
/** A library collection's own bookkeeping fields (a table's capacity, a threshold) are not content: two that differ there are not known to differ. */
const plainContent = type => type[0] === '[' || type === 'Ljava/util/ArrayList;' || type === 'Ljava/util/Arrays$ArrayList;' || !COLLECTION.test(type);
/** 'same' | 'new-instance' (another instance, the same class and content) | 'value' (a value inside changed) | 'unknown' (cannot be told) | 'mutated' (the same instance, other content). */
export function compareNodes(a, b, top = true) {
  if (a.t === undefined || b.t === undefined) { if (a.t === undefined && b.t === undefined) return a.v === b.v ? 'same' : 'value'; return 'value'; }   // null and an object, a boxed value and an object
  if (a.id === b.id) {
    if (!top || !a.c || !b.c || (!COLLECTION.test(a.t) && !isModel(a.t))) return 'same';   // the same instance; a collection or a class of the app may have been changed in place
    return contents(a, b) === 'same' ? 'same' : 'mutated';
  }
  if (a.t !== b.t) return 'value';   // another class: another value
  if (!a.c || !b.c) return 'unknown';   // two instances that were not looked into
  const inside = contents(a, b); return inside === 'same' || inside === 'new-instance' ? 'new-instance' : inside === 'mutated' ? 'unknown' : inside;
}
const isModel = type => !/^L(?:androidx|android|java|kotlin|kotlinx)\//.test(type);
function contents(a, b) {
  let result = a.more || b.more ? 'unknown' : 'same'; const value = plainContent(a.t) ? 'value' : 'unknown';
  if (a.c.length !== b.c.length) return value;
  for (let i = 0; i < a.c.length; i++) {
    if (a.c[i][0] !== b.c[i][0]) return 'unknown';
    const child = compareNodes(a.c[i][1], b.c[i][1], false); if (child === 'value') return value;
    if (child === 'unknown') result = 'unknown'; else if (child === 'new-instance' && result === 'same') result = 'new-instance';
  }
  return result;
}
/** What an input's class is, in the words of the report. */
export function inputClass(runtime, node) {
  if (node.t === undefined) return 'value';
  const type = node.t; if (isFunction(runtime, type)) return `lambda (${simple(type)})`;
  return type[0] === '[' ? 'array' : simple(type);
}
/**
 * What the inputs say about a recomposition that the scope did not ask for itself: { verdict: 'needed' | 'avoidable' | 'unnecessary' | 'unknown', reason, inputs: [names] }.
 * needed: a value changed. avoidable: every changed input is a new instance with the same content. unnecessary: no input changed.
 */
export function compareInputs(runtime, before, after) {
  if (!after) return { verdict: 'unknown', reason: 'its inputs cannot be read' };
  if (!before) return { verdict: 'unknown', reason: 'its previous composition was not seen (it was composed before counting started)' };
  if (before.length !== after.length) return { verdict: 'unknown', reason: 'its inputs cannot be matched' };
  const created = [], unknown = [];
  for (let i = 0; i < after.length; i++) {
    const a = before[i], b = after[i], result = compareNodes(a.node, b.node);
    if (result === 'value') return { verdict: 'needed', reason: `${b.lambda ? 'the lambda captured other values' : `${b.name} changed`}` };
    if (result === 'new-instance') created.push(b.lambda ? `the content lambda was created again with the same captured values` : `${b.name}: a new ${inputClass(runtime, b.node)} each time, with the same content`);
    else if (result === 'mutated') unknown.push(`${b.name}: the same instance, changed in place`);
    else if (result === 'unknown') unknown.push(`${b.name}: another ${inputClass(runtime, b.node)}, too large or opaque to compare`);
  }
  if (unknown.length) return { verdict: 'unknown', reason: unknown[0] };
  if (created.length) return { verdict: 'avoidable', reason: created.join('; ') };
  return { verdict: 'unnecessary', reason: after.length ? 'every input is the same (it is not skippable, or nothing let Compose skip it)' : 'it has no inputs' };
}
export const isComposableLambda = definition => isLambdaImpl(definition.method.owner);
export { fieldOf };
