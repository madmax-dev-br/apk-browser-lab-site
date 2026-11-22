// The Java debugger of the lab's VM (docs/DEBUGGER.md): breakpoints, stepping and inspection of the app's DEX code, as a JDWP-capable ART offers them, on both engines -- the
// JavaScript interpreter (src/interpreter.js) and the WebAssembly core (vmcore/interp.c, through vmcore/js/core-debug.js). Runs in the VM Worker (src/apk-worker.js "debug-*"
// messages) and in Node tests. No DOM, no process.*.
//
// How a breakpoint works. The debugger writes its own opcode (0x73, unused in DEX) over the opcode byte of the instruction, in the method's own copy of its code: the JavaScript
// interpreter's decoded code units (prog.units becomes a copy the first time a method gets a breakpoint; the method then stays interpreted: no compiled or direct form, no frameless
// fast path) or the core's linked code in linear memory. Nothing else changes: an instruction without a breakpoint runs exactly as before, so a VM with no breakpoint armed -- or
// with the debugger detached -- pays nothing on its hot paths. A breakpoint in a method that has no code yet (not called yet, its class not loaded, its DEX not loaded) stays
// pending and is armed when the engine first decodes or links the method (prepared / linked below), with a 'breakpoint-resolved' event.
// When the opcode runs, the engine asks the debugger (stop): the breakpoints at that address are tested (thread, condition, hit condition), logpoints log, and the thread either
// goes on (the original instruction runs once and the breakpoint is written back) or stops. Stepping: the JavaScript interpreter's instruction probe (APKRuntime.instructionProbe)
// while a step is in progress; on the core a single-step budget (Thread.debugFlags DEBUG_STEP: the instruction past Thread.maxSteps stops the run with STEPPED) and, to step
// over or out of a call at full speed, a temporary breakpoint at the return address. Exception breakpoints: the interpreter's unwinding asks the debugger at the throw; the core
// stops the run with EXCEPTION_EVENT before it unwinds (DEBUG_EXCEPTIONS, only while an exception breakpoint or a step needs it).
//
// How a thread stops (docs/DEBUGGER.md, "Suspension"). A browser Worker cannot block on a JavaScript stack and still receive messages, so a stopped thread is held in one of three
// ways, the first that applies:
//   parked    the thread runs as a slice of the event pump with no host code of its own on the JavaScript stack (a background thread; on the core also the main thread in a
//             Looper message, which the core can suspend): it is parked with the debugger's Blocked, the JavaScript stack unwinds and the Worker stays free. Suspend policy 'all'
//             (the default) holds every other thread too (Scheduler.held: they are not scheduled) and no main-thread event runs; 'thread' holds only this one.
//   in place  any other thread (host code below it on the JavaScript stack: an input event, a lifecycle callback, a nested call): when a synchronous channel is attached (a
//             SharedArrayBuffer the page shares, or a test's function) the debugger serves the page's commands right there, the Worker blocked in Atomics.wait meanwhile; every
//             thread is suspended, as nothing else can run.
//   snapshot  neither: the stop is reported with the thread's frames and values as they were (`held: false`) and the thread goes on; no step can start from it.
// While every thread is suspended the VM clock stands still (VMClock.debugPause: the host time of the pause is not part of it) and no timer or event of the VM runs.
import { APKError } from './apk-error.js?v=67f3eead5b24';
import { createHeapReader, handleOf, parseHandle, dotted, typeName, primitiveValue, PluginQueryError, classDescriptor, resolveStaticPath, runPluginQuery } from './plugin-queries.js?v=67f3eead5b24';
import { debugInfoOf, lineAt, pcsOfLine, isLineStart, localsAt, wordsOf } from './debug-info.js?v=67f3eead5b24';
import { Blocked } from './scheduler.js?v=67f3eead5b24';
import { debugCatchTarget } from './interpreter.js?v=67f3eead5b24';

/** The Code browser's read-only operations (src/code-service.js) the `code` command serves while the Worker is held in place. */
export const CODE_READS = new Set(['search', 'class-tree', 'class-info', 'disassemble', 'java-outline', 'read-file', 'file-edits', 'files']);
import { WIDE_HIGH } from './apk-runtime.js?v=67f3eead5b24';
import { invokeAppMethod } from './app-invoke.js?v=67f3eead5b24';

export const DEBUG_OPCODE = 0x73;
export const DEBUG_LIMITS = Object.freeze({ breakpoints: 500, expression: 2000, log: 4000, frames: 256, events: 64, steps: 2_000_000 });
export class DebuggerError extends Error { constructor(code, message) { super(message); this.name = 'DebuggerError'; this.code = code; } }
const fail = (code, message) => { throw new DebuggerError(code, message); };
const INVOKE_OPS = new Set([0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78, 0xfa, 0xfb, 0xfc, 0xfd, 0xf0, 0xf1]);
const RETURN_OPS = new Set([0x0e, 0x0f, 0x10, 0x11]);
const FIELD_READ = op => (op >= 0x52 && op <= 0x58) || (op >= 0x60 && op <= 0x66), FIELD_WRITE = op => (op >= 0x59 && op <= 0x5f) || (op >= 0x67 && op <= 0x6d);
const STATIC_FIELD = op => op >= 0x60 && op <= 0x6d;
// code units of each instruction format by opcode (for walking a method's instructions)
const UNITS = new Uint8Array(256).fill(1);
for (const [ops, n] of [[[0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f, 0x20, 0x22, 0x23, 0x29, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0xfe, 0xff], 2],
  [[0x03, 0x06, 0x09, 0x14, 0x17, 0x1b, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2c, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78, 0xfc, 0xfd, 0xf0, 0xf1], 3], [[0x18], 5], [[0xfa, 0xfb], 4]]) for (const op of ops) UNITS[op] = n;
for (let op = 0x32; op <= 0x37; op++) UNITS[op] = 2;
for (let op = 0x44; op <= 0x6d; op++) UNITS[op] = 2;
for (let op = 0x90; op <= 0xaf; op++) UNITS[op] = 2;
for (let op = 0xd0; op <= 0xe2; op++) UNITS[op] = 2;
/** The width in code units of the instruction (or payload) at `pc`. */
function widthAt(units, pc) {
  const unit = units[pc], op = unit & 255;
  if (op === 0 && unit !== 0) {   // a payload: packed-switch, sparse-switch, fill-array-data
    if (unit === 0x100) return 4 + units[pc + 1] * 2;
    if (unit === 0x200) return 2 + units[pc + 1] * 4;
    if (unit === 0x300) { const width = units[pc + 1], size = units[pc + 2] | (units[pc + 3] << 16); return 4 + Math.ceil(width * size / 2); }
  }
  return UNITS[op];
}
/** The instruction starts of a method's code: [pc]. */
export function instructionStarts(units) { const out = []; for (let pc = 0; pc < units.length; pc += Math.max(1, widthAt(units, pc))) { const unit = units[pc]; if ((unit & 255) !== 0 || unit === 0) out.push(pc); } return out; }

// ---- method specs ----------------------------------------------------------------------------------------------------------------------------------------------------
/** 'Lpkg/C;->name(I)V' | { className, method|name, signature } -> { owner, name, signature|null }. */
export function parseMethodRef(spec) {
  if (typeof spec === 'string') {
    const match = /^(\[*L[^;]+;|[^-]+)->([^(\s]+)(\([^)]*\)\S*)?$/.exec(spec.trim());
    if (!match) fail('bad-args', `Invalid method: ${spec.slice(0, 200)} (expected Lpkg/Class;->name(Params)Ret)`);
    return { owner: classDescriptor(match[1]), name: match[2], signature: match[3] ?? null };
  }
  if (spec && typeof spec === 'object') {
    const owner = classDescriptor(spec.className ?? spec.class ?? ''), name = String(spec.method ?? spec.name ?? '');
    if (!name) fail('bad-args', 'Name the method');
    return { owner, name, signature: spec.signature ? String(spec.signature).replace(/\s+/g, '') : null };
  }
  fail('bad-args', 'Name the method: "Lpkg/Class;->name(Params)Ret" or { className, method, signature }');
}
const keyOf = (owner, name, signature) => `${owner}->${name}${signature}`;
const describeMethod = key => { const at = key.indexOf('->'); return at < 0 ? key : `${dotted(key.slice(0, at))}.${key.slice(at + 2)}`; };

// ---- expressions (read-only: names, fields, array elements, literals, arithmetic, comparisons) ----------------------------------------------------------------------
const TOKEN = /\s*(?:(\d+\.\d*(?:[eE][+-]?\d+)?[fFdD]?|\d+[eE][+-]?\d+[fFdD]?|0[xX][0-9a-fA-F]+[lL]?|\d+[lLfFdD]?)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)')|([A-Za-z_$][\w$]*)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!()[\].,?:]))/y;
function tokenize(text) {
  const out = []; TOKEN.lastIndex = 0; let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) break;
    TOKEN.lastIndex = at; const m = TOKEN.exec(text);
    if (!m) fail('bad-expression', `Unexpected text at ${at}: ${text.slice(at, at + 20)}`);
    at = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ kind: 'number', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'string', value: JSON.parse(m[2]) });
    else if (m[3] !== undefined) out.push({ kind: 'char', value: JSON.parse(`"${m[3].slice(1, -1).replace(/"/g, '\\"')}"`) });
    else if (m[4] !== undefined) out.push({ kind: 'name', text: m[4] });
    else out.push({ kind: 'op', text: m[5] });
  }
  return out;
}
/** Parses a read-only expression into a tree. Method calls are refused by name (an invoke is a separate, explicit request). */
export function parseExpression(text) {
  const source = String(text ?? ''); if (!source.trim()) fail('bad-expression', 'Empty expression');
  if (source.length > DEBUG_LIMITS.expression) fail('bad-expression', 'Expression too long');
  const tokens = tokenize(source); let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++], isOp = (t, ...ops) => t && t.kind === 'op' && ops.includes(t.text);
  const expect = op => { const t = next(); if (!isOp(t, op)) fail('bad-expression', `Expected "${op}"`); };
  const binary = (sub, ops) => () => { let left = sub(); while (isOp(peek(), ...ops)) { const op = next().text; left = { kind: 'binary', op, left, right: sub() }; } return left; };
  const primary = () => {
    const t = next(); if (!t) fail('bad-expression', 'Unexpected end of expression');
    if (t.kind === 'number') return { kind: 'literal', value: numberLiteral(t.text) };
    if (t.kind === 'string') return { kind: 'literal', value: { type: 'Ljava/lang/String;', value: t.value } };
    if (t.kind === 'char') return { kind: 'literal', value: { type: 'C', value: t.value.charCodeAt(0) } };
    if (t.kind === 'name') {
      if (t.text === 'true' || t.text === 'false') return { kind: 'literal', value: { type: 'Z', value: t.text === 'true' ? 1 : 0 } };
      if (t.text === 'null') return { kind: 'literal', value: { type: 'null', value: null } };
      return { kind: 'name', name: t.text };
    }
    if (isOp(t, '(')) { const inner = ternary(); expect(')'); return inner; }
    if (isOp(t, '-', '!')) return { kind: 'unary', op: t.text, operand: postfix(primary()) };
    fail('bad-expression', `Unexpected "${t.text ?? t.kind}"`);
  };
  const postfix = node => {
    for (;;) {
      if (isOp(peek(), '.')) { next(); const t = next(); if (!t || t.kind !== 'name') fail('bad-expression', 'Expected a field name after "."'); if (isOp(peek(), '(')) fail('unsupported', `Method calls are not evaluated (${t.text}(...)): use the debugger's invoke, which runs on the paused thread`); node = { kind: 'member', object: node, name: t.text }; continue; }
      if (isOp(peek(), '[')) { next(); const index = ternary(); expect(']'); node = { kind: 'index', object: node, index }; continue; }
      if (isOp(peek(), '(')) fail('unsupported', 'Method calls are not evaluated: use the debugger\'s invoke, which runs on the paused thread');
      return node;
    }
  };
  const unary = () => { if (isOp(peek(), '-', '!')) { const op = next().text; return { kind: 'unary', op, operand: unary() }; } return postfix(primary()); };
  const multiplicative = binary(unary, ['*', '/', '%']), additive = binary(multiplicative, ['+', '-']), relational = binary(additive, ['<', '<=', '>', '>=']);
  const equality = binary(relational, ['==', '!=']), and = binary(equality, ['&&']), or = binary(and, ['||']);
  const ternary = () => { const test = or(); if (!isOp(peek(), '?')) return test; next(); const yes = ternary(); expect(':'); return { kind: 'conditional', test, yes, no: ternary() }; };
  const tree = ternary(); if (i < tokens.length) fail('bad-expression', `Unexpected "${tokens[i].text ?? tokens[i].kind}"`);
  return tree;
}
function numberLiteral(text) {
  const lower = text.toLowerCase();
  if (/^0x/.test(lower)) { const long = lower.endsWith('l'); const big = BigInt(long ? lower.slice(0, -1) : lower); return long ? { type: 'J', value: BigInt.asIntN(64, big) } : { type: 'I', value: Number(BigInt.asIntN(32, big)) }; }
  if (lower.endsWith('l')) return { type: 'J', value: BigInt.asIntN(64, BigInt(lower.slice(0, -1))) };
  if (lower.endsWith('f')) return { type: 'F', value: Math.fround(Number(lower.slice(0, -1))) };
  if (lower.endsWith('d') || /[.e]/.test(lower)) return { type: 'D', value: Number(lower.replace(/d$/, '')) };
  const n = Number(lower); return Number.isSafeInteger(n) && n >= -2147483648 && n <= 2147483647 ? { type: 'I', value: n } : { type: 'J', value: BigInt(lower) };
}

// ---- typed values the evaluator works on: { type: descriptor | 'null', value } -- ints as numbers, longs as BigInt, floats/doubles as JS numbers, references as the engine's
// host value ({ ref } or a JavaScript string). Raw register contents are converted on read (fromRaw) and back on write (toRaw).
const floats = new DataView(new ArrayBuffer(8));
const bitsToFloat = bits => { floats.setInt32(0, Number(bits) | 0, true); return floats.getFloat32(0, true); };
const floatToBits = value => { floats.setFloat32(0, value, true); return floats.getInt32(0, true); };
const bitsToDouble = bits => { floats.setBigInt64(0, BigInt.asIntN(64, BigInt(bits)), true); return floats.getFloat64(0, true); };
const doubleToBits = value => { floats.setFloat64(0, value, true); return floats.getBigInt64(0, true); };
const isReference = type => type === 'null' || (typeof type === 'string' && (type[0] === 'L' || type[0] === '['));
const numeric = value => value.type === 'J' ? value.value : value.type === 'Z' ? (value.value ? 1 : 0) : value.value;
function promote(a, b) {
  const order = ['D', 'F', 'J']; for (const type of order) if (a.type === type || b.type === type) return type;
  return 'I';
}
function asNumber(value, type) {
  const v = value.value;
  if (type === 'J') return typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)));
  if (type === 'D' || type === 'F') return Number(v);
  return Number(v) | 0;
}

/**
 * The debugger of one runtime. `options`: onEvent(event) for every event (paused, resumed, breakpoint-resolved, thread-started, thread-ended, exception, log, detached);
 * channel: a synchronous channel ({ receive(state) -> command, reply(id, outcome) }) that lets a thread be held in place (see the header); suspend: the default suspend
 * policy of breakpoints ('all' | 'thread').
 */
export class JavaDebugger {
  static debugInfo = debugInfoOf; static lineAt = lineAt; static isLineStart = isLineStart; static instructionStarts = instructionStarts;
  constructor(runtime, { onEvent = () => {}, channel = null, suspend = 'all', now = () => performance.now() } = {}) {
    if (!runtime) fail('no-apk', 'No APK is running.');
    this.rt = runtime; this.onEvent = onEvent; this.channel = channel; this.defaultSuspend = suspend === 'thread' ? 'thread' : 'all'; this.now = now;
    this.breakpoints = new Map(); this.nextId = 1; this.sites = new Map(); this.pendingByOwner = new Map(); this.exceptionBreakpoints = new Set(); this.fieldWatches = new Set();
    this.held = new Set(); this.stops = new Map(); this.stepsByThread = new Map(); this.returns = new Map(); this.passMarks = new WeakMap(); this.reportedThrows = new WeakSet();
    this.attached = false; this.hitsSuspended = 0; this.syncDepth = 0; this.stats = { hits: 0, logs: 0, stops: 0, steps: 0, snapshots: 0, commands: 0 };
    this.events = 0; this.clockPaused = false;
  }
  handleOf(id) { return handleOf(this.rt, id); }
  get engine() { return this.rt.engine === 'wasm' && this.rt.wasm ? 'wasm' : 'js'; }

  // ---- attach / detach
  attach() {
    const rt = this.rt;
    if (rt.debugger === this) return this.state();
    if (rt.debugger !== null && rt.debugger !== undefined) fail('busy', 'Another debugger is attached to this VM.');
    this.adapter = this.engine === 'wasm' ? rt.wasm.debugAdapter(this) : new JsDebugAdapter(this);
    rt.debugger = this; this.attached = true;
    const sched = rt.scheduler, start = sched.start, terminate = sched.terminate;
    this.restoreScheduler = () => { sched.start = start; sched.terminate = terminate; sched.held = null; };
    sched.start = (thread, driver) => { const result = start.call(sched, thread, driver); this.adapter.threadStarted?.(thread); this.emit({ type: 'thread-started', thread: this.threadInfo(thread) }); return result; };
    sched.terminate = thread => { const result = terminate.call(sched, thread); this.held.delete(thread); this.stops.delete(thread); this.stepsByThread.delete(thread); this.emit({ type: 'thread-ended', thread: { id: threadId(thread), name: thread.name } }); this.syncHeld(); return result; };
    this.trace('attach', `engine ${this.engine}${this.channel ? ', in-place holds available' : ''}`);
    return this.state();
  }
  detach() {
    if (!this.attached) return { detached: true };
    const rt = this.rt;
    for (const site of this.sites.values()) if (site.armed) this.adapter.disarm(site);
    this.sites.clear(); this.breakpoints.clear(); this.pendingByOwner.clear(); this.exceptionBreakpoints.clear(); this.fieldWatches.clear();
    for (const thread of [...this.stepsByThread.keys()]) this.adapter.endStep(thread);
    this.stepsByThread.clear(); this.held.clear(); this.stops.clear();
    this.adapter.refreshExceptions(false);
    this.adapter.detach();
    this.restoreScheduler(); this.resumeClock();
    rt.debugger = null; rt.debugRearm = null; this.attached = false;
    this.trace('detach', '');
    this.emit({ type: 'detached' });
    this.onResumed?.();
    return { detached: true };
  }
  /** Every debugger action goes to the VM's trace (as a host task's line: never dropped as the Looper's own plumbing). */
  trace(action, detail) { const rt = this.rt, traced = rt.hostTaskTrace; rt.hostTaskTrace = true; try { rt.record?.(`DEBUG ${action}${detail ? ' ' + detail : ''}`); } finally { rt.hostTaskTrace = traced; } }
  emit(event) { this.events++; try { this.onEvent(event); } catch { /* the page's handler must not break the VM */ } }
  state() {
    return { attached: this.attached, engine: this.engine, paused: this.stops.size > 0 || this.held.size > 0, held: [...this.held].map(threadId), inPlace: this.syncDepth > 0, channel: this.channel !== null,
      breakpoints: [...this.breakpoints.values()].map(bp => this.describeBreakpoint(bp)), stops: [...this.stops.entries()].map(([thread, stop]) => ({ thread: threadId(thread), ...stop.summary })) };
  }

  // ---- breakpoints
  /**
   * Sets a breakpoint. spec: { type: 'line', className, line } | { type: 'location', method, pc } | { type: 'entry' | 'exit', method } | { type: 'exception', exceptionClass?,
   * caught = true, uncaught = true } | { type: 'field', className, field, access: 'read' | 'write' | 'any' }; for all: condition, hitCondition ('5', '>= 5', '== 5', '% 5'),
   * logMessage (a logpoint: logs, never stops; {expression} parts are evaluated), suspend ('all' | 'thread'), enabled, thread (a thread id: only that thread stops).
   */
  setBreakpoint(spec = {}) {
    if (this.breakpoints.size >= DEBUG_LIMITS.breakpoints) fail('limit', `At most ${DEBUG_LIMITS.breakpoints} breakpoints.`);
    const type = spec.type ?? (spec.line !== undefined ? 'line' : spec.pc !== undefined ? 'location' : spec.exceptionClass !== undefined ? 'exception' : spec.field !== undefined ? 'field' : null);
    if (!['line', 'location', 'entry', 'exit', 'exception', 'field'].includes(type)) fail('bad-args', 'Breakpoint type: line, location, entry, exit, exception or field');
    const bp = { id: spec.id !== undefined ? String(spec.id) : `bp${this.nextId++}`, type, enabled: spec.enabled !== false, hits: 0, locations: [], resolved: false, verified: true, message: null,
      condition: null, conditionText: null, hitCondition: null, logMessage: null, suspend: spec.suspend === 'thread' ? 'thread' : spec.suspend === 'all' ? 'all' : this.defaultSuspend, thread: spec.thread !== undefined && spec.thread !== null ? String(spec.thread) : null };
    if (this.breakpoints.has(bp.id)) fail('bad-args', `A breakpoint ${bp.id} exists already`);
    if (spec.condition !== undefined && spec.condition !== null && String(spec.condition).trim()) { bp.conditionText = String(spec.condition); bp.condition = parseExpression(bp.conditionText); }
    if (spec.hitCondition !== undefined && spec.hitCondition !== null && String(spec.hitCondition).trim()) bp.hitCondition = parseHitCondition(spec.hitCondition);
    if (spec.logMessage !== undefined && spec.logMessage !== null) { const text = String(spec.logMessage); if (text.length > DEBUG_LIMITS.log) fail('bad-args', 'Log message too long'); bp.logMessage = parseLogMessage(text); bp.logText = text; }
    if (type === 'exception') {
      bp.exceptionClass = spec.exceptionClass ? classDescriptor(spec.exceptionClass) : null; bp.caught = spec.caught !== false; bp.uncaught = spec.uncaught !== false; bp.resolved = true;
      this.breakpoints.set(bp.id, bp); this.exceptionBreakpoints.add(bp); this.adapter.refreshExceptions(this.wantsExceptions());
    } else if (type === 'field') {
      bp.owner = classDescriptor(spec.className ?? ''); bp.field = String(spec.field ?? ''); if (!bp.field) fail('bad-args', 'Name the field');
      bp.access = spec.access === 'read' ? 'read' : spec.access === 'write' ? 'write' : 'any';
      this.breakpoints.set(bp.id, bp); this.fieldWatches.add(bp);
      this.adapter.armWatch(bp);
      bp.resolved = bp.locations.length > 0;
    } else {
      if (type === 'line') {
        bp.owner = classDescriptor(spec.className ?? spec.class ?? ''); bp.line = Number(spec.line);
        if (!Number.isInteger(bp.line) || bp.line < 1) fail('bad-args', 'line: a positive integer');
        bp.methodName = spec.method ? String(spec.method) : null;
      } else {
        const ref = parseMethodRef(spec.method ?? spec);
        bp.owner = ref.owner; bp.name = ref.name; bp.signature = ref.signature;
        if (type === 'location') { bp.pc = Number(spec.pc); if (!Number.isInteger(bp.pc) || bp.pc < 0) fail('bad-args', 'pc: a code unit offset (integer >= 0)'); }
      }
      this.breakpoints.set(bp.id, bp);
      const owners = this.pendingByOwner.get(bp.owner) ?? new Set(); owners.add(bp); this.pendingByOwner.set(bp.owner, owners);
      this.resolveNow(bp);
    }
    this.trace('breakpoint set', `${bp.id} ${this.describeWhere(bp)}${bp.conditionText ? ` if ${bp.conditionText}` : ''}${bp.logText ? ` log "${bp.logText}"` : ''}${bp.resolved ? '' : ' (pending)'}`);
    return this.describeBreakpoint(bp);
  }
  removeBreakpoint(id) {
    const bp = this.breakpoints.get(String(id)); if (!bp) fail('no-breakpoint', `No breakpoint ${id}`);
    this.breakpoints.delete(bp.id); this.exceptionBreakpoints.delete(bp); this.fieldWatches.delete(bp); this.pendingByOwner.get(bp.owner)?.delete(bp);
    for (const site of [...this.sites.values()]) if (site.reasons.delete(bp)) this.maybeDropSite(site);
    if (bp.type === 'exception') this.adapter.refreshExceptions(this.wantsExceptions());
    this.trace('breakpoint removed', `${bp.id} (${bp.hits} hits)`);
    return { removed: bp.id };
  }
  enableBreakpoint(id, enabled = true) {
    const bp = this.breakpoints.get(String(id)); if (!bp) fail('no-breakpoint', `No breakpoint ${id}`);
    bp.enabled = !!enabled;
    // an enabled breakpoint is armed; a disabled one keeps its sites only when another reason needs them
    for (const site of this.sites.values()) if (site.reasons.has(bp)) { if (bp.enabled && !site.armed) this.arm(site); else if (!bp.enabled) this.maybeDisarm(site); }
    if (bp.type === 'exception') this.adapter.refreshExceptions(this.wantsExceptions());
    this.trace(enabled ? 'breakpoint enabled' : 'breakpoint disabled', bp.id);
    return this.describeBreakpoint(bp);
  }
  listBreakpoints() { return [...this.breakpoints.values()].map(bp => this.describeBreakpoint(bp)); }
  describeWhere(bp) {
    if (bp.type === 'line') return `${dotted(bp.owner)}:${bp.line}`;
    if (bp.type === 'exception') return `exception ${bp.exceptionClass ? dotted(bp.exceptionClass) : '(any)'}${bp.caught && bp.uncaught ? '' : bp.caught ? ' caught' : ' uncaught'}`;
    if (bp.type === 'field') return `field ${dotted(bp.owner)}.${bp.field} (${bp.access})`;
    return `${bp.type} ${dotted(bp.owner)}.${bp.name}${bp.signature ?? ''}${bp.type === 'location' ? ` pc ${bp.pc}` : ''}`;
  }
  describeBreakpoint(bp) {
    return { id: bp.id, type: bp.type, where: this.describeWhere(bp), enabled: bp.enabled, resolved: bp.resolved, verified: bp.verified, message: bp.message, hits: bp.hits, suspend: bp.suspend,
      ...(bp.thread ? { thread: bp.thread } : {}), ...(bp.conditionText ? { condition: bp.conditionText } : {}), ...(bp.hitCondition ? { hitCondition: bp.hitCondition.text } : {}),
      ...(bp.logText !== undefined ? { logMessage: bp.logText } : {}), locations: bp.locations.map(location => ({ ...location })) };
  }
  wantsExceptions() { for (const bp of this.exceptionBreakpoints) if (bp.enabled) return true; for (const step of this.stepsByThread.values()) if (step.exceptions) return true; return false; }

  /** The DEX definitions of a class: [{ key, definition }] (no class: []). Reading DEX data runs nothing of the app (no class is initialized). */
  definitionsOf(owner) {
    let cls = null; try { cls = this.rt.classes?.get?.(owner) ?? null; } catch { cls = null; }
    if (!cls?.methods) return null;
    const out = []; for (const definition of cls.methods.values()) if (definition.code) out.push({ key: definition.method.key ?? keyOf(owner, definition.method.name, definition.method.signature), definition });
    return out;
  }
  /** The code locations of breakpoint `bp` in `definition`: [pc]. */
  pcsIn(bp, definition, units = null) {
    const method = definition.method;
    if (bp.type === 'line') { if (bp.methodName && method.name !== bp.methodName) return []; return pcsOfLine(debugInfoOf(definition), bp.line); }
    if (method.name !== bp.name || (bp.signature && method.signature !== bp.signature && !(bp.signature.endsWith(')') && method.signature.startsWith(bp.signature)))) return [];
    if (bp.type === 'location') return bp.pc < definition.code.units ? [bp.pc] : [];
    if (bp.type === 'entry') return [0];
    if (bp.type === 'exit') { units ??= this.adapter.originalUnits(definition); return instructionStarts(units).filter(pc => RETURN_OPS.has(units[pc] & 255)); }
    return [];
  }
  /** At set time: the methods of the class whose code is decoded or linked are armed now; the others when the engine prepares them (prepared / linked). */
  resolveNow(bp) {
    const definitions = this.definitionsOf(bp.owner);
    if (definitions === null) { bp.message = `${dotted(bp.owner)} is not in the loaded DEX files yet: pending until a DEX that defines it is loaded`; return; }
    let found = 0;
    for (const { key, definition } of definitions) {
      const pcs = this.pcsIn(bp, definition); if (!pcs.length) continue;
      found += pcs.length;
      const target = this.adapter.targetOf(definition);
      if (target !== null) this.placeAt(bp, key, definition, target, pcs);
    }
    if (!found) { bp.verified = false; bp.message = bp.type === 'line' ? `No code at line ${bp.line} in ${dotted(bp.owner)}${definitions.some(d => debugInfoOf(d.definition)?.hasDebugInfo) ? '' : ' (its DEX has no line information)'}` : `No such method with code in ${dotted(bp.owner)}: ${bp.name}${bp.signature ?? ''}`; }
    else if (!bp.resolved) bp.message = 'pending: the method has not run yet (armed when the VM first links it)';
  }
  /** A method's code was decoded (JavaScript interpreter) or linked (core): pending breakpoints of its class are armed in it. */
  methodReady(key, definition, target) {
    if (!definition?.code) return;
    const owner = definition.method.owner, bps = this.pendingByOwner.get(owner);
    if (bps !== undefined && bps.size) for (const bp of bps) { const pcs = this.pcsIn(bp, definition); if (pcs.length) this.placeAt(bp, key, definition, target, pcs); }
    if (this.fieldWatches.size) for (const bp of this.fieldWatches) this.adapter.watchIn(bp, key, definition, target);
  }
  placeAt(bp, key, definition, target, pcs) {
    let added = false;
    for (const pc of pcs) {
      const site = this.siteFor(key, definition, target, pc);
      if (site.reasons.has(bp)) continue;
      site.reasons.add(bp); added = true;
      if (bp.enabled && !site.armed) this.arm(site);
      if (!bp.locations.some(l => l.method === key && l.pc === pc)) bp.locations.push(this.location(key, definition, pc));
    }
    if (added && !bp.resolved) { bp.resolved = true; bp.message = null; this.trace('breakpoint resolved', `${bp.id} at ${bp.locations.map(l => `${describeMethod(l.method)}@${l.pc}`).join(', ')}`); this.emit({ type: 'breakpoint-resolved', breakpoint: this.describeBreakpoint(bp) }); }
  }
  siteFor(key, definition, target, pc) {
    const siteKey = this.adapter.siteKey(target, pc); let site = this.sites.get(siteKey);
    if (!site) { site = { key: siteKey, method: key, definition, target, pc, reasons: new Set(), armed: false, orig: 0 }; this.sites.set(siteKey, site); }
    return site;
  }
  arm(site) { if (!site.armed) { this.adapter.arm(site); site.armed = true; } }
  maybeDisarm(site) { if (site.armed && ![...site.reasons].some(reason => reason.enabled !== false)) { this.adapter.disarm(site); site.armed = false; } }
  maybeDropSite(site) { this.maybeDisarm(site); if (!site.reasons.size) { if (site.armed) { this.adapter.disarm(site); site.armed = false; } this.sites.delete(site.key); } }
  location(key, definition, pc) {
    const info = definitionInfo(definition), at = key.indexOf('->'), owner = key.slice(0, at), nameSig = key.slice(at + 2), paren = nameSig.indexOf('(');
    return { method: key, className: dotted(owner), methodName: nameSig.slice(0, paren), signature: nameSig.slice(paren), pc, line: lineAt(info, pc), source: info?.sourceFile ?? null };
  }

  // ---- the engines ask: stop here?
  /** The thread is resuming from a stop at (frame, pc): the instruction there runs once without stopping again. */
  /** interpreter.js prepareCore / vmcore linker.linkCode: a method's code is ready to run. */
  prepared(prog) { this.adapter.prepared?.(prog); }
  linked(mi) { this.adapter.linked?.(mi); }
  passing(thread, frame, pc) { const mark = this.passMarks.get(frame); if (mark === pc) { this.passMarks.delete(frame); return true; } return false; }
  /** A breakpoint's original opcode goes back for one instruction (JavaScript interpreter: APKRuntime.debugRearm writes the breakpoint back after it). */
  passOver(prog, pc, thread, frame) { return this.adapter.passOver?.(prog, pc, thread, frame) ?? false; }
  wantsThrow(error) { return this.exceptionBreakpoints.size > 0 && !this.reportedThrows.has(error); }   // (a step of the JavaScript interpreter sees the handler through its probe)

  /**
   * An engine stopped `thread` (kind 'breakpoint' | 'step' | 'exception') at `pc` of its top frame (`frameRef`, the engine's own). Decides whether it stops and how (see the
   * header): returns true to park it (the engine parks it with parkBlocked), false to let it go on (after holding it in place, or at once).
   */
  stop(thread, frameRef, pc, parkable, kind, thrown) {
    if (!this.attached || this.hitsSuspended > 0) return false;
    const where = this.adapter.whereOf(thread, frameRef, pc);
    let reasons = [], suspend = 'thread', exception = null;
    if (kind === 'breakpoint') {
      const site = this.sites.get(this.adapter.siteKey(where.target, pc));
      if (site) for (const reason of [...site.reasons]) {
        if (reason.kind === 'step-return') { if (this.stepReturnHit(thread, reason, where)) { reasons.push({ type: 'step' }); suspend = 'all'; } continue; }
        if (reason.kind === 'early-return') continue;
        if (reason.kind === 'run-to') { if (reason.thread === thread) { reasons.push({ type: 'run-to' }); suspend = 'all'; this.dropTemp(reason); } continue; }
        if (!reason.enabled) continue;
        if (reason.type === 'field' && !this.adapter.accessMatches(reason, where, pc)) continue;
        const verdict = this.test(reason, thread, where);
        if (verdict === 'stop') { reasons.push({ type: 'breakpoint', id: reason.id }); if (reason.suspend === 'all') suspend = 'all'; }
      }
      if (!reasons.length) {   // a step in progress on this thread sees the instruction too (a breakpoint did not stop it)
        const step = this.stepsByThread.get(thread);
        if (step && this.stepWants(step, where) === 'stop') { reasons.push({ type: 'step' }); suspend = 'all'; }
      }
    } else if (kind === 'step') {
      const step = this.stepsByThread.get(thread);
      if (!step) return false;
      const verdict = this.stepWants(step, where);
      if (verdict !== 'stop') return false;
      reasons.push({ type: 'step' }); suspend = 'all';
    } else if (kind === 'exception') {
      if (thrown !== null && typeof thrown === 'object') this.reportedThrows.add(thrown);
      exception = this.adapter.exceptionOf(thread, thrown);
      const handler = this.adapter.catchOf(thread, frameRef, pc, thrown);
      exception.caught = handler !== null; if (handler) exception.catchLocation = handler.location;
      for (const bp of this.exceptionBreakpoints) {
        if (!bp.enabled || (bp.thread && bp.thread !== threadId(thread))) continue;
        if (bp.exceptionClass && !this.isSubtype(exception.descriptor, bp.exceptionClass)) continue;
        if (handler ? !bp.caught : !bp.uncaught) continue;
        const verdict = this.test(bp, thread, where);
        if (verdict === 'stop') { reasons.push({ type: 'exception', id: bp.id }); if (bp.suspend === 'all') suspend = 'all'; }
      }
      const step = this.stepsByThread.get(thread);
      if (step) this.adapter.stepThrow?.(thread, step, handler);
      this.emit({ type: 'exception', thread: threadId(thread), exception: { type: exception.type, message: exception.message, caught: exception.caught, handle: exception.handle }, location: where.location, stopped: reasons.length > 0 });
    }
    if (!reasons.length) return false;
    return this.stopThread(thread, frameRef, where, reasons, suspend, parkable, exception, kind);
  }
  /** Breakpoint tests in order: thread filter, condition (an error stops, with the error), hit condition, logpoint. 'stop' | 'go'. */
  test(bp, thread, where) {
    if (bp.thread && bp.thread !== threadId(thread)) return 'go';
    let conditionError = null;
    if (bp.condition) {
      try { const value = this.evaluateTree(bp.condition, thread, where, where); if (!truthy(value)) return 'go'; }
      catch (error) { conditionError = String(error?.message ?? error); }
    }
    bp.hits++; this.stats.hits++;
    if (bp.hitCondition && !bp.hitCondition.test(bp.hits)) return 'go';
    if (bp.logMessage && conditionError === null) {
      const text = bp.logMessage.map(part => typeof part === 'string' ? part : this.logValue(part, thread, where)).join('');
      this.stats.logs++;
      this.rt.record?.(`LOG I Debugger: ${text}`);
      this.trace('logpoint', `${bp.id} ${describeMethod(where.method)}@${where.pc}: ${text.slice(0, 300)}`);
      this.emit({ type: 'log', breakpoint: bp.id, thread: threadId(thread), location: where.location, message: text });
      return 'go';
    }
    if (conditionError !== null) where.conditionError = { breakpoint: bp.id, message: conditionError };
    return 'stop';
  }
  logValue(tree, thread, where) {
    try { return shortText(this.render(this.evaluateTree(tree, thread, where, where), { depth: 0 })); }
    catch (error) { return `<${error?.message ?? error}>`; }
  }
  isSubtype(type, ancestor) { if (type === ancestor) return true; try { return this.rt.isSubtype(type, ancestor); } catch { return false; } }

  /** The thread stops: parked, held in place or reported as a snapshot (see the header). */
  stopThread(thread, frameRef, where, reasons, suspend, parkable, exception, kind = 'breakpoint') {
    this.stats.stops++;
    const step = this.stepsByThread.get(thread); if (step && reasons.some(reason => reason.type !== 'log')) this.endStep(thread);
    const mode = parkable ? 'parked' : this.channel !== null && this.syncDepth === 0 ? 'in-place' : 'snapshot';
    const summary = { reason: reasons[0].type, reasons, location: where.location, mode, ...(exception ? { exception: { type: exception.type, message: exception.message, caught: exception.caught, handle: exception.handle, ...(exception.catchLocation ? { catchLocation: exception.catchLocation } : {}) } } : {}), ...(where.conditionError ? { conditionError: where.conditionError } : {}) };
    const stop = { summary, frameRef, pc: where.pc, kind: reasons[0].type, exception };
    this.stops.set(thread, stop);
    if (mode === 'snapshot') {
      this.stats.snapshots++;
      const frames = this.safe(() => this.frames(threadId(thread), { count: 32, values: true }), []);
      this.trace('stop', `${threadId(thread)} ${summary.reason} at ${describeMethod(where.method)}@${where.pc} (snapshot: this thread runs inside host code and no synchronous channel is attached, it goes on)`);
      this.emit({ type: 'paused', thread: threadId(thread), threadName: thread.name, ...summary, held: false, why: this.channel !== null ? 'a stop inside another stop held in place' : 'the thread runs inside host code on the Worker\'s JavaScript stack and the page shares no synchronous channel (no cross-origin isolation): reported as it was, then it goes on', frames, threads: this.threadsSummary() });
      this.stops.delete(thread);
      this.emit({ type: 'resumed', thread: threadId(thread), reason: 'snapshot' });
      return false;
    }
    if (suspend === 'all') for (const other of this.allThreads()) this.held.add(other); else this.held.add(thread);
    this.syncHeld();
    this.trace('stop', `${threadId(thread)} ${summary.reason}${reasons.filter(r => r.id).map(r => ' ' + r.id).join('')} at ${describeMethod(where.method)}@${where.pc} line ${where.location.line} (${mode}, suspend ${suspend})`);
    this.emit({ type: 'paused', thread: threadId(thread), threadName: thread.name, ...summary, held: true, suspend, threads: this.threadsSummary() });
    if (mode === 'parked') { if (kind === 'breakpoint') this.passMarks.set(frameRef, where.pc); return true; }   // resuming runs the instruction under the breakpoint without stopping again
    this.holdInPlace(thread, stop);
    return false;
  }
  safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
  allThreads() { const sched = this.rt.scheduler, out = new Set([sched.mainThread(), ...sched.threads]); return [...out].filter(thread => thread.state !== 'terminated'); }
  /** The scheduler's view of the holds (Scheduler.held: a held thread is not picked), the clock (stands still while every thread is held). */
  syncHeld() {
    const sched = this.rt.scheduler; sched.held = this.held.size ? this.held : null;
    const all = this.held.size > 0 && this.allThreads().every(thread => this.held.has(thread));
    if (all) this.pauseClock(); else this.resumeClock();
  }
  pauseClock() { if (this.clockPaused) return; this.clockPaused = true; this.rt.platform?.clock?.debugPause?.(); }
  resumeClock() { if (!this.clockPaused) return; this.clockPaused = false; this.rt.platform?.clock?.debugResume?.(); }
  /** The debugger's wait for a parked thread: ready once the thread is no longer held. A stop at an exception resumes its unwinding (finish throws it again). */
  parkBlocked(thread, kind, thrown) {
    const blocked = new Blocked({ ready: () => !this.held.has(thread) || !this.attached, reason: 'debugger', retry: kind !== 'exception', finish: kind === 'exception' ? () => { throw thrown; } : () => undefined });
    blocked.debugHold = true;
    return blocked;
  }
  /** Is `thread` held by the debugger (the event pump must not run its events)? */
  holds(thread) { return this.held.has(thread); }
  get mainHeld() { return this.held.size > 0 && this.held.has(this.rt.scheduler.mainThread()); }
  /** The event pump while the main thread is held (android-platform.js drainEvents): no main-thread event runs; the threads that are not held get their slices. */
  drainHeld(runtime, hostBudgetMs = 8) {
    let processed = 0; const started = performance.now(), sched = runtime.scheduler;
    while (runtime.multiThreaded && sched.hasRunnable() && performance.now() - started < hostBudgetMs) {
      runtime.steps = 0; runtime.sliceDeadline = performance.now() + Math.min(8, hostBudgetMs);
      try { runtime.runThreads(); } finally { runtime.sliceDeadline = 0; }
      processed++;
    }
    const threadDelay = sched.threadDelay();
    return { processed, mainProcessed: 0, pending: 0, waitingIO: 0, eventDelay: null, nextDelay: threadDelay, debugHeld: true };
  }

  /** Holds `thread` in place: the channel's commands are served until it is resumed (or the debugger detaches). */
  holdInPlace(thread, stop) {
    this.syncDepth++;
    const previous = this.rt.thread;
    try {
      while (this.attached && this.held.has(thread)) {
        let command;
        try { command = this.channel.receive(this.state()); }
        catch (error) { this.trace('channel failed', String(error?.message ?? error)); this.resumeAll('channel failed'); break; }
        if (command === null || command === undefined) { this.resumeAll('channel closed'); break; }
        let outcome;
        try { outcome = { result: this.execute(command.name ?? command.type, command.args ?? command) }; }
        catch (error) { outcome = { error: { code: error?.code ?? 'failed', message: String(error?.message ?? error) } }; }
        finally { this.rt.thread = previous; }
        try { this.channel.reply?.(command.id ?? null, outcome); } catch { /* the page went away: the next receive tells */ }
      }
    } finally { this.syncDepth--; this.rt.thread = previous; }
  }

  // ---- commands (the Worker's debug-* messages and the in-place channel use the same names)
  execute(name, args = {}) {
    this.stats.commands++;
    switch (String(name ?? '').replace(/^debug-/, '')) {
      case 'attach': return this.attach();
      case 'detach': return this.detach();
      case 'state': return this.state();
      case 'set-breakpoint': case 'setBreakpoint': return this.setBreakpoint(args.breakpoint ?? args);
      case 'remove-breakpoint': case 'removeBreakpoint': return this.removeBreakpoint(args.id);
      case 'enable-breakpoint': case 'enableBreakpoint': return this.enableBreakpoint(args.id, args.enabled !== false);
      case 'breakpoints': return this.listBreakpoints();
      case 'pause': return this.pause(args);
      case 'resume': return this.resume(args);
      case 'step': return this.step(args);
      case 'run-to': case 'runTo': return this.runTo(args);
      case 'threads': return this.threads();
      case 'frames': return this.frames(args.thread, args);
      case 'locals': return this.locals(args.thread, args.frame ?? 0, args);
      case 'evaluate': return this.evaluate(args.thread, args.frame ?? 0, args.expression, args);
      case 'set-local': case 'setLocal': return this.setLocal(args.thread, args.frame ?? 0, args.name, args.value);
      case 'invoke': return this.invoke(args);
      case 'return': case 'early-return': case 'earlyReturn': return this.earlyReturn(args);
      case 'inspect': return runPluginQuery(this.rt, 'inspect', { handle: args.handle, options: args.options });
      case 'field': return runPluginQuery(this.rt, 'field', { handle: args.handle, path: args.path, options: args.options });
      case 'code': {   // the Code browser's reads (src/code-service.js) while the Worker is held in place (its messages wait): only what reads, never an edit
        if (typeof this.codeService !== 'function') fail('unsupported', 'The Code browser\'s reads are not available in this VM.');
        const op = String(args.op ?? '');
        if (!CODE_READS.has(op)) fail('debugger-paused', `"${op.slice(0, 40)}" changes the app: resume the VM first (only the Code browser's reads are served while it is held).`);
        return this.codeService(op, args.args ?? {});
      }
      default: fail('bad-command', `Unknown debugger command: ${String(name).slice(0, 40)}`);
    }
  }

  // ---- execution control
  threadById(id) {
    if (id === undefined || id === null) { const stopped = [...this.stops.keys()][0]; if (stopped) return stopped; return this.rt.scheduler.mainThread(); }
    const text = String(id); for (const thread of this.allThreads()) if (threadId(thread) === text || thread.name === text) return thread;
    fail('no-thread', `No live thread ${text}`);
  }
  /** Suspends every thread (or one): between two VM events every thread is at a safepoint already, so the pause takes effect at once; the threads stay where they are. */
  pause(args = {}) {
    const threads = args.thread !== undefined && args.thread !== null ? [this.threadById(args.thread)] : this.allThreads();
    for (const thread of threads) { this.held.add(thread); if (!this.stops.has(thread)) { const top = this.safe(() => this.adapter.frames(thread)[0], null); this.stops.set(thread, { summary: { reason: 'pause', reasons: [{ type: 'pause' }], location: top ? this.frameLocation(top) : null, mode: 'parked' }, kind: 'pause' }); } }
    this.syncHeld();
    this.trace('pause', args.thread !== undefined && args.thread !== null ? threadId(threads[0]) : 'all threads');
    this.emit({ type: 'paused', reason: 'pause', thread: threads.length === 1 ? threadId(threads[0]) : null, held: true, suspend: threads.length === 1 ? 'thread' : 'all', threads: this.threadsSummary() });
    return this.state();
  }
  /** Resumes every thread (or one: the others stay held). */
  resume(args = {}) {
    if (args.thread !== undefined && args.thread !== null) {
      const thread = this.threadById(args.thread); this.held.delete(thread); this.stops.delete(thread); this.syncHeld();
      this.trace('resume', threadId(thread)); this.emit({ type: 'resumed', thread: threadId(thread) }); this.onResumed?.();
      return this.state();
    }
    this.resumeAll('resume');
    return this.state();
  }
  resumeAll(why) {
    this.held.clear(); this.stops.clear(); this.syncHeld();
    this.trace('resume', why === 'resume' ? 'all threads' : why);
    this.emit({ type: 'resumed', thread: null, reason: why });
    this.onResumed?.();
  }
  /**
   * Steps `thread` (default: the stopped one): kind 'into' | 'over' | 'out', unit 'line' (default, by the .line table) or 'instruction'. Every thread runs meanwhile (as a JDWP
   * debugger resumes the VM for a step) and every thread is suspended again where the step ends.
   */
  step(args = {}) {
    const thread = this.threadById(args.thread), stop = this.stops.get(thread);
    const kind = ['into', 'over', 'out'].includes(args.kind) ? args.kind : 'over', unit = args.unit === 'instruction' ? 'instruction' : 'line';
    if (!stop && !this.held.has(thread)) fail('not-paused', `${thread.name} is not paused`);
    const frames = this.adapter.frames(thread); if (!frames.length) fail('no-frames', `${thread.name} has no Java frames to step in`);
    const top = frames[0]; if (top.host || top.compiled) fail('no-frames', `${thread.name} is in host code: no Java instruction to step from`);
    const step = { thread, kind, unit, depth: top.depth, frame: top.frame, method: top.key, line: this.frameLocation(top).line, pc: top.pc, started: false, count: 0, exceptions: false };
    this.stepsByThread.set(thread, step); this.stats.steps++;
    this.adapter.beginStep(thread, step, top);
    this.trace('step', `${threadId(thread)} ${kind} ${unit} from ${describeMethod(top.key)}@${top.pc} line ${top.line}`);
    this.held.clear(); this.stops.clear(); this.syncHeld();
    this.emit({ type: 'resumed', thread: threadId(thread), reason: 'step' });
    this.onResumed?.();
    return { stepping: threadId(thread), kind, unit, from: this.frameLocation(top) };
  }
  /** Runs `thread` to a location ({ method, pc } or { className, line }): a temporary breakpoint for that thread only, then resume. */
  runTo(args = {}) {
    const thread = this.threadById(args.thread), reason = { kind: 'run-to', thread, enabled: true, sites: [] };
    const bp = { type: args.line !== undefined ? 'line' : 'location', owner: null, enabled: true };
    if (bp.type === 'line') { bp.owner = classDescriptor(args.className ?? ''); bp.line = Number(args.line); }
    else { const ref = parseMethodRef(args.method ?? args); Object.assign(bp, { owner: ref.owner, name: ref.name, signature: ref.signature, pc: Number(args.pc ?? 0) }); }
    const definitions = this.definitionsOf(bp.owner) ?? [];
    for (const { key, definition } of definitions) {
      const target = this.adapter.targetOf(definition); if (target === null) continue;
      for (const pc of this.pcsIn(bp, definition)) { const site = this.siteFor(key, definition, target, pc); site.reasons.add(reason); reason.sites.push(site); this.arm(site); }
    }
    if (!reason.sites.length) fail('no-location', 'run-to: no linked code at that location yet (set a breakpoint instead: it waits for the method)');
    this.trace('run-to', `${threadId(thread)} ${bp.type === 'line' ? `${dotted(bp.owner)}:${bp.line}` : `${describeMethod(keyOf(bp.owner, bp.name, bp.signature ?? ''))}@${bp.pc}`}`);
    this.resumeAll('run-to');
    return { running: threadId(thread), sites: reason.sites.length };
  }
  dropTemp(reason) { for (const site of reason.sites ?? []) { site.reasons.delete(reason); this.maybeDropSite(site); } reason.sites = []; }

  // ---- stepping (decisions shared by both engines; the adapters only report where the thread is)
  /** Where a step stands at the instruction `where` is about to run: 'stop' or 'go'. */
  stepWants(step, where) {
    if (step.thread !== this.rt.thread && step.thread !== where.thread) return 'go';
    if (!step.started) {   // the instruction the step starts from runs first
      if (where.frame === step.frame && where.pc === step.pc) { step.started = true; return 'go'; }
      step.started = true;
    }
    if (++step.count > DEBUG_LIMITS.steps) { this.trace('step', `${threadId(step.thread)}: gave up after ${DEBUG_LIMITS.steps} instructions`); return 'stop'; }
    const depth = where.depth;
    if (step.kind === 'out') return depth < step.depth ? 'stop' : 'go';
    if (depth < step.depth) return 'stop';   // returned (or unwound) into a caller: the step ends there, after the call
    if (depth > step.depth) return step.kind === 'into' ? 'stop' : 'go';   // into: the callee's first instruction; over: inside the call
    if (step.unit === 'instruction' || where.frame !== step.frame || !where.hasLines) return 'stop';   // another activation at the same depth: the frame returned and the caller called again
    return where.line !== step.line && where.lineStart ? 'stop' : 'go';
  }
  stepReturnHit(thread, reason, where) {
    if (reason.thread !== thread || where.frame !== reason.frame) return false;
    const step = this.stepsByThread.get(thread);
    this.dropTemp(reason);
    if (!step) return false;
    step.returnSite = null; step.exceptions = false; this.adapter.bound?.(thread);
    return this.stepWants(step, where) === 'stop';
  }
  endStep(thread) { const step = this.stepsByThread.get(thread); if (!step) return; this.stepsByThread.delete(thread); if (step.returnSite) this.dropTemp(step.returnSite); this.adapter.endStep(thread, step); if (step.exceptions) this.adapter.refreshExceptions(this.wantsExceptions()); }

  // ---- inspection
  threadInfo(thread) {
    const stop = this.stops.get(thread);
    return { id: threadId(thread), name: thread.name, state: threadState(thread), held: this.held.has(thread), daemon: !!thread.daemon, main: thread === this.rt.scheduler.main, ...(stop ? { stop: stop.summary } : {}) };
  }
  threadsSummary() { return this.allThreads().map(thread => this.threadInfo(thread)); }
  threads() {
    this.trace('threads', '');
    return this.allThreads().map(thread => { const info = this.threadInfo(thread), top = this.safe(() => this.adapter.frames(thread)[0], null); return { ...info, frames: this.safe(() => this.adapter.frames(thread).length, 0), location: top ? this.frameLocation(top) : null, blocked: thread.blocked?.reason ?? null }; });
  }
  frameLocation(frame) {
    if (frame.host) return { host: true, method: frame.key ?? null };
    return { ...this.location(frame.key, frame.definition, frame.pc), ...(frame.compiled ? { compiled: true } : {}) };
  }
  /** The thread's stack, innermost first: [{ index, method, className, methodName, signature, pc, line, source, receiver? }] (host code between Java frames shows as { host: true }). */
  frames(id, { start = 0, count = DEBUG_LIMITS.frames, values = true } = {}) {
    const thread = this.threadById(id), frames = this.adapter.frames(thread), out = [];
    const mark = this.adapter.mark?.(); this.trace('frames', threadId(thread));
    try {
      for (let i = Math.max(0, start); i < frames.length && out.length < Math.min(count, DEBUG_LIMITS.frames); i++) {
        const frame = frames[i], entry = { index: i, ...this.frameLocation(frame) };
        if (!frame.host && values && frame.definition && !(frame.definition.flags & 0x8)) {
          const receiver = this.safe(() => this.readTyped(frame, frame.registers - frame.ins, frame.definition.method.owner), null);
          if (receiver !== null) entry.receiver = this.render(receiver, { depth: 0 });
        }
        out.push(entry);
      }
    } finally { this.adapter.release?.(mark); }
    return { thread: threadId(thread), total: frames.length, frames: out };
  }
  frameAt(thread, index) {
    const frames = this.adapter.frames(thread), frame = frames[Number(index) | 0];
    if (!frame) fail('no-frame', `${thread.name} has no frame ${index}`);
    if (frame.host || frame.compiled) fail('no-frame', `Frame ${index} of ${thread.name} is ${frame.host ? 'host code' : 'a compiled activation'}: it has no registers to read`);
    return frame;
  }
  /** Registers and locals of a frame: the parameters and the locals live at its pc with names and types from the debug info, then every register (v0..vN, p0..pK). */
  locals(id, index = 0, { depth = 1, registers = true } = {}) {
    const thread = this.threadById(id), frame = this.frameAt(thread, index), info = definitionInfo(frame.definition), mark = this.adapter.mark?.();
    this.trace('locals', `${threadId(thread)}#${Number(index) | 0}`);
    try {
      const named = [], seen = new Set();
      const add = (name, type, register, kind) => {
        const typed = this.safe(() => this.readTyped(frame, register, type), null);
        named.push({ name, type: typeName(type), register: `v${register}`, kind, value: typed === null ? null : this.render(typed, { depth }) }); seen.add(register);
      };
      for (const parameter of info?.parameters ?? []) if (parameter.name !== null || !info?.hasDebugInfo) add(parameter.name ?? `p${parameter.register - (frame.registers - frame.ins)}`, parameter.type, parameter.register, parameter.name === 'this' ? 'this' : 'parameter');
      for (const local of localsAt(info, frame.pc)) if (!seen.has(local.register)) add(local.name, local.type, local.register, 'local');
      const out = { thread: threadId(thread), frame: Number(index) | 0, location: this.frameLocation(frame), debugInfo: !!info?.hasDebugInfo, locals: named };
      if (registers) {
        out.registers = [];
        for (let r = 0; r < frame.registers; r++) {
          const raw = this.safe(() => this.adapter.readRaw(frame, r), undefined);
          const name = r >= frame.registers - frame.ins ? `p${r - (frame.registers - frame.ins)}` : `v${r}`;
          out.registers.push({ register: `v${r}`, ...(name[0] === 'p' ? { alias: name } : {}), value: this.renderRaw(frame, r, raw) });
        }
      }
      return out;
    } finally { this.adapter.release?.(mark); }
  }
  renderRaw(frame, register, raw) {
    if (raw === undefined) return null;
    const typed = this.adapter.untyped(frame, register, raw);
    return typed === null ? null : this.render(typed, { depth: 0 });
  }
  /** A typed value of register `register` of `frame` for declared type `type`. */
  readTyped(frame, register, type) {
    if (type === 'J' || type === 'D') { const bits = this.adapter.readWide(frame, register); return { type, value: type === 'J' ? bits : bitsToDouble(bits) }; }
    const raw = this.adapter.readRaw(frame, register);
    if (isReference(type)) return { type, value: this.adapter.reference(raw) };
    if (type === 'F') return { type, value: bitsToFloat(raw) };
    return { type, value: Number(raw) | 0 };
  }
  /** JSON of a typed value, as the plugin queries render a value (objects as handles to expand with inspect / field). */
  render(typed, { depth = 1 } = {}) {
    if (typed.type === 'null' || typed.value === null || typed.value === undefined) return null;
    const reader = createHeapReader(this.rt);
    switch (typed.type) {
      case 'Z': return !!typed.value;
      case 'C': return String.fromCharCode(Number(typed.value) & 0xffff);
      case 'J': { const v = BigInt.asIntN(64, BigInt(typed.value)); return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : String(v); }
      case 'F': case 'D': return Number.isFinite(typed.value) ? typed.value : String(typed.value);
      case 'I': case 'S': case 'B': return Number(typed.value) | 0;
      default: return reader.view(typed.value, isReference(typed.type) ? typed.type : 'Ljava/lang/Object;', { depth }).value;
    }
  }
  /** Evaluates a read-only expression in frame `index` of the thread. */
  evaluate(id, index = 0, expression, { depth = 1 } = {}) {
    const thread = this.threadById(id), frame = this.frameAt(thread, index), mark = this.adapter.mark?.();
    try {
      const tree = parseExpression(expression), typed = this.evaluateTree(tree, thread, frame, { frame, pc: frame.pc, definition: frame.definition });
      this.trace('evaluate', `${threadId(thread)}#${index}: ${String(expression).slice(0, 200)}`);
      return { expression: String(expression), type: typed.type === 'null' ? 'null' : typeName(typed.type), value: this.render(typed, { depth }), ...(typed.value && typeof typed.value === 'object' && typeof typed.value.ref === 'number' ? { handle: handleOf(this.rt, typed.value.ref) } : {}) };
    } finally { this.adapter.release?.(mark); }
  }
  /** The value of a name in a frame: a local or parameter (by its debug-info name), `this`, a register (v3, p0), or a class (for its static fields). */
  lookupName(name, frame, where) {
    const info = definitionInfo(frame.definition), pc = where?.pc ?? frame.pc;
    if (name === 'this') { if (frame.definition.flags & 0x8) fail('bad-expression', 'A static method has no this'); return this.readTyped(frame, frame.registers - frame.ins, frame.definition.method.owner); }
    const local = [...localsAt(info, pc)].reverse().find(entry => entry.name === name) ?? info?.parameters.find(p => p.name === name);
    if (local) return this.readTyped(frame, local.register, local.type);
    const register = /^([vp])(\d+)$/.exec(name);
    if (register) {
      const n = register[1] === 'p' ? frame.registers - frame.ins + Number(register[2]) : Number(register[2]);
      if (n >= frame.registers) fail('bad-expression', `No register ${name} (the frame has ${frame.registers})`);
      const declared = info?.parameters.find(p => p.register === n) ?? localsAt(info, pc).find(entry => entry.register === n);
      if (declared) return this.readTyped(frame, n, declared.type);
      const untyped = this.adapter.untyped(frame, n, this.adapter.readRaw(frame, n));
      if (untyped === null) fail('bad-expression', `${name} holds no value here`);
      return untyped;
    }
    // a field of `this` by its name, as Java scoping finds it
    if (!(frame.definition.flags & 0x8)) { const self = this.safe(() => this.readTyped(frame, frame.registers - frame.ins, frame.definition.method.owner), null); if (self && self.value) { const field = this.fieldOf(self, name, true); if (field) return field; } }
    return { type: 'class-path', path: [name] };
  }
  /** A field of an object value ({ type: 'Lx;', value }), or null when it has none named so (throwing unless `soft`). */
  fieldOf(object, name, soft = false) {
    if (object.type === 'class-path') return { type: 'class-path', path: [...object.path, name] };
    if (object.value === null || object.value === undefined) fail('null', `NullPointerException: reading ${name} of null`);
    const reader = createHeapReader(this.rt), value = object.value;
    if (typeof value === 'string') { if (name === 'length') fail('unsupported', 'String.length() is a method call: use invoke'); if (soft) return null; fail('bad-expression', `java.lang.String has no field ${name} the evaluator reads`); }
    const rec = reader.isRef(value) ? reader.record(value.ref) : null;
    if (!rec) { if (soft) return null; fail('collected', 'object collected'); }
    if (rec.cells !== undefined) { if (name === 'length') return { type: 'I', value: rec.cells.length }; if (soft) return null; fail('bad-expression', `An array has no field ${name}`); }
    const fields = reader.fields(rec), field = fields.find(entry => entry.name === name);
    if (!field) { if (soft) return null; fail('bad-expression', `${typeName(rec.type)} has no field ${name}`); }
    return this.fieldValue(field.type, field.value);
  }
  fieldValue(type, raw) {
    if (type === 'J') return { type, value: BigInt.asIntN(64, BigInt(raw ?? 0)) };
    if (type === 'D') return { type, value: typeof raw === 'number' && !Number.isInteger(raw) ? raw : bitsToDouble(raw ?? 0) };
    if (type === 'F') return { type, value: bitsToFloat(raw ?? 0) };
    if (isReference(type)) return { type, value: raw === undefined || raw === 0 ? null : raw };
    return { type, value: Number(raw ?? 0) | 0 };
  }
  evaluateTree(tree, thread, frame, where = null) {
    const resolveClassPath = value => {
      if (value.type !== 'class-path') return value;
      // pkg.Class.FIELD: the longest prefix that names a class, the rest a static path (never initializing a class: plugin-queries resolveStaticPath)
      for (let cut = value.path.length - 1; cut >= 1; cut--) {
        const className = value.path.slice(0, cut).join('.'), rest = value.path.slice(cut);
        let cls = null; try { cls = this.rt.classes?.get?.(classDescriptor(className)); } catch { cls = null; }
        if (!cls) continue;
        const reader = createHeapReader(this.rt), target = resolveStaticPath(this.rt, reader, className, rest);
        return this.fieldValue(target.type, target.value);
      }
      fail('bad-expression', `Unknown name: ${value.path.join('.')}`);
    };
    const run = node => {
      switch (node.kind) {
        case 'literal': return node.value;
        case 'name': return this.lookupName(node.name, frame, where);
        case 'member': { const object = run(node.object); if (object.type === 'class-path') { const extended = { type: 'class-path', path: [...object.path, node.name] }; try { return resolveClassPath(extended); } catch (error) { if (error?.code === 'bad-expression' && /Unknown name/.test(error.message)) return extended; throw error; } } return this.fieldOf(object, node.name); }
        case 'index': {
          const object = resolveClassPath(run(node.object)), index = resolveClassPath(run(node.index));
          if (object.value === null) fail('null', 'NullPointerException: indexing null');
          const reader = createHeapReader(this.rt), rec = reader.isRef(object.value) ? reader.record(object.value.ref) : null;
          if (!rec || rec.cells === undefined) fail('bad-expression', 'Not an array');
          const i = Number(numeric(index)); if (!Number.isInteger(i) || i < 0 || i >= rec.cells.length) fail('bounds', `ArrayIndexOutOfBoundsException: length=${rec.cells.length}; index=${i}`);
          return this.fieldValue(rec.type.slice(1), rec.cells[i]);
        }
        case 'unary': {
          const value = resolveClassPath(run(node.operand));
          if (node.op === '!') return { type: 'Z', value: truthy(value) ? 0 : 1 };
          const type = promote(value, { type: 'I' }), n = asNumber(value, type);
          return { type, value: type === 'J' ? BigInt.asIntN(64, -n) : type === 'I' ? (-n) | 0 : -n };
        }
        case 'conditional': return truthy(resolveClassPath(run(node.test))) ? resolveClassPath(run(node.yes)) : resolveClassPath(run(node.no));
        case 'binary': {
          if (node.op === '&&') return { type: 'Z', value: truthy(resolveClassPath(run(node.left))) && truthy(resolveClassPath(run(node.right))) ? 1 : 0 };
          if (node.op === '||') return { type: 'Z', value: truthy(resolveClassPath(run(node.left))) || truthy(resolveClassPath(run(node.right))) ? 1 : 0 };
          const left = resolveClassPath(run(node.left)), right = resolveClassPath(run(node.right));
          return binaryOp(this, node.op, left, right);
        }
        default: fail('bad-expression', `Cannot evaluate ${node.kind}`);
      }
    };
    return resolveClassPath(run(tree));
  }
  /** Sets a local (by name or register) of frame `index` to `value` (a number, boolean, string, null, or an object handle "h12.ab"). */
  setLocal(id, index, name, value) {
    const thread = this.threadById(id), frame = this.frameAt(thread, index), info = definitionInfo(frame.definition);
    if (!this.stops.has(thread) && !this.held.has(thread)) fail('not-paused', `${thread.name} is not paused`);
    const text = String(name ?? ''), register = /^([vp])(\d+)$/.exec(text);
    let n, type;
    if (register) { n = register[1] === 'p' ? frame.registers - frame.ins + Number(register[2]) : Number(register[2]); type = (info?.parameters.find(p => p.register === n) ?? localsAt(info, frame.pc).find(l => l.register === n))?.type ?? null; }
    else {
      const local = (text === 'this' ? null : [...localsAt(info, frame.pc)].reverse().find(entry => entry.name === text)) ?? info?.parameters.find(p => p.name === text);
      if (!local) fail('bad-args', `No local ${text} at this point of the method`);
      n = local.register; type = local.type;
    }
    if (n >= frame.registers) fail('bad-args', `No register v${n}`);
    type ??= typeof value === 'number' && Number.isInteger(value) ? 'I' : typeof value === 'boolean' ? 'Z' : typeof value === 'number' ? 'F' : 'Ljava/lang/Object;';
    const typed = this.convert(type, value);
    this.adapter.write(frame, n, typed);
    this.trace('set local', `${threadId(thread)}#${index} ${text} (v${n}) = ${shortText(this.render(typed, { depth: 0 }))}`);
    return { name: text, register: `v${n}`, type: typeName(type), value: this.render(typed, { depth: 0 }) };
  }
  convert(type, value) {
    if (isReference(type)) {
      if (value === null || value === undefined) return { type, value: null };
      if (typeof value === 'string' && /^h\d+\.[0-9a-z]+$/.test(value)) { const id = parseHandle(this.rt, value), rec = this.rt.heap?.get?.(id); if (!rec) fail('collected', 'object collected'); if (!this.isSubtype(rec.type, type)) fail('bad-args', `${typeName(rec.type)} is not a ${typeName(type)}`); return { type: rec.type, value: { ref: rec.id ?? id } }; }
      if (typeof value === 'string' && this.isSubtype('Ljava/lang/String;', type)) return { type: 'Ljava/lang/String;', value };
      fail('bad-args', `A ${typeName(type)} local takes null or an object handle`);
    }
    if (type === 'Z') return { type, value: value === true || value === 1 ? 1 : value === false || value === 0 ? 0 : fail('bad-args', 'A boolean local takes true or false') };
    if (type === 'J') { try { return { type, value: BigInt.asIntN(64, BigInt(value)) }; } catch { fail('bad-args', 'A long local takes an integer'); } }
    if (type === 'F' || type === 'D') { const n = Number(value); if (typeof value === 'boolean' || !Number.isFinite(n) && !Number.isNaN(n)) fail('bad-args', 'A floating-point local takes a number'); return { type, value: type === 'F' ? Math.fround(n) : n }; }
    if (type === 'C' && typeof value === 'string' && value.length === 1) return { type, value: value.charCodeAt(0) };
    const n = Number(value); if (!Number.isInteger(n)) fail('bad-args', `A ${typeName(type)} local takes an integer`);
    return { type, value: type === 'B' ? (n << 24) >> 24 : type === 'S' ? (n << 16) >> 16 : type === 'C' ? n & 0xffff : n | 0 };
  }
  /**
   * Force-early-return: the top frame of a paused thread returns `value` (converted to the method's return type; nothing for void) when the thread goes on, without running the
   * rest of its code. Monitors the frame entered stay entered (a synchronized block it is inside is not exited); a class initializer cannot return early.
   */
  earlyReturn(args = {}) {
    const thread = this.threadById(args.thread);
    const stop = this.stops.get(thread);
    if (!stop && !this.held.has(thread)) fail('not-paused', `${thread.name} is not paused`);
    if (stop?.kind === 'exception') fail('unsupported', 'An early return from an exception stop is not supported (resume: the exception goes on, or step to its handler)');
    if (this.engine === 'wasm' && !['breakpoint', 'step', 'run-to'].includes(stop?.kind)) fail('unsupported', 'On the WebAssembly core a frame returns early from a breakpoint or a step only (this thread is suspended elsewhere)');
    const top = this.adapter.frames(thread)[0];
    if (!top || top.host || top.compiled) fail('no-frames', `${thread.name} has no Java frame on top to return from`);
    const method = top.definition.method;
    if (method.name === '<clinit>') fail('unsupported', 'A class initializer cannot return early');
    const type = method.result, typed = type === 'V' ? { type: 'V', value: undefined } : this.convert(type, args.value);
    const entry = { frame: top.frame, typed, value: this.adapter.returnValue?.(typed) ?? typed.value, site: null };
    this.returns.set(thread, entry);
    this.adapter.armReturn?.(thread, top, entry);
    this.trace('early return', `${threadId(thread)} ${describeMethod(top.key)} returns ${type === 'V' ? 'void' : shortText(this.render(typed, { depth: 0 }))}`);
    return { thread: threadId(thread), method: top.key, returns: typeName(type), value: type === 'V' ? null : this.render(typed, { depth: 0 }) };
  }
  /** The engine asks, when `thread`'s frame `frame` goes on: the value it returns now, or undefined. */
  takeReturn(thread, frame) {
    const entry = this.returns.get(thread); if (entry === undefined || entry.frame !== (frame?.frame ?? frame)) return undefined;
    this.returns.delete(thread);
    if (entry.site) { entry.site.reasons.delete(entry.reason); this.maybeDropSite(entry.site); }
    return entry;
  }
  /**
   * Calls a method on a held thread (src/app-invoke.js resolution and argument conversion): { thread, className, method, signature?, args, receiver? (handle) }. Runs on that
   * thread above its paused frames, with every breakpoint and step suspended meanwhile and the instruction budget of an event; other threads stay suspended. Recorded in the trace.
   */
  invoke(args = {}) {
    const thread = this.threadById(args.thread), rt = this.rt;
    if (!this.held.has(thread)) fail('not-paused', `${thread.name} is not paused: invoke runs on a paused thread`);
    const previousThread = rt.thread, previousSteps = rt.steps;
    this.hitsSuspended++; rt.nestedRuns++;   // a run nested on this thread (not a new event on main): APKRuntime.execute / WasmEngine.runNested keep rt.thread
    rt.thread = thread;
    this.trace('invoke', `${threadId(thread)} ${args.className ?? ''}.${args.method ?? ''}`);
    try { return invokeAppMethod(rt, { className: args.className, method: args.method, signature: args.signature, args: args.args, receiver: args.receiver, handle: args.receiver ?? args.handle, options: args.options }); }
    finally { rt.nestedRuns--; this.hitsSuspended--; rt.thread = previousThread; rt.steps = previousSteps; }
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------------------------
export const threadId = thread => String(thread?.id ?? '');
function threadState(thread) {
  if (thread.state === 'terminated') return 'terminated';
  if (thread.state === 'new' || !thread.started) return 'new';
  if (thread.state === 'blocked') { const reason = thread.blocked?.reason ?? ''; return reason === 'debugger' ? 'suspended' : /monitor/.test(reason) ? 'monitor' : /sleep/i.test(reason) ? 'sleeping' : 'waiting'; }
  return 'running';
}
const definitionInfo = definition => definition ? debugInfoOf(definition) : null;
function truthy(value) {
  if (value.type === 'Z' || value.type === 'I' || value.type === 'B' || value.type === 'S' || value.type === 'C') return Number(value.value) !== 0;
  if (value.type === 'J') return value.value !== 0n;
  if (value.type === 'F' || value.type === 'D') return value.value !== 0 && !Number.isNaN(value.value);
  return value.value !== null && value.value !== undefined;
}
function sameReference(a, b) {
  const x = a.value, y = b.value;
  if ((x === null || x === undefined) || (y === null || y === undefined)) return (x === null || x === undefined) && (y === null || y === undefined);
  if (typeof x === 'string' || typeof y === 'string') return x === y;
  return typeof x === 'object' && typeof y === 'object' && x.ref === y.ref;
}
function binaryOp(dbg, op, left, right) {
  if (op === '+' && (left.type === 'Ljava/lang/String;' || right.type === 'Ljava/lang/String;')) return { type: 'Ljava/lang/String;', value: stringOf(dbg, left) + stringOf(dbg, right) };
  if (op === '==' || op === '!=') {
    let equal;
    if (isReference(left.type) || isReference(right.type)) equal = sameReference(left, right);
    else { const type = promote(left, right); equal = asNumber(left, type) === asNumber(right, type); }
    return { type: 'Z', value: (op === '==') === equal ? 1 : 0 };
  }
  if (isReference(left.type) || isReference(right.type)) fail('bad-expression', `"${op}" needs numbers`);
  const type = promote(left, right), x = asNumber(left, type), y = asNumber(right, type);
  if (['<', '<=', '>', '>='].includes(op)) return { type: 'Z', value: (op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y) ? 1 : 0 };
  if (type === 'J') {
    if ((op === '/' || op === '%') && y === 0n) fail('arithmetic', 'ArithmeticException: divide by zero');
    const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x % y; return { type, value: BigInt.asIntN(64, r) };
  }
  if (type === 'I') {
    if ((op === '/' || op === '%') && y === 0) fail('arithmetic', 'ArithmeticException: divide by zero');
    const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? Math.imul(x, y) : op === '/' ? (x === -2147483648 && y === -1 ? x : Math.trunc(x / y)) : (y === -1 ? 0 : x % y); return { type, value: r | 0 };
  }
  const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? x / y : x % y; return { type, value: type === 'F' ? Math.fround(r) : r };
}
function stringOf(dbg, value) {
  if (value.type === 'null' || value.value === null || value.value === undefined) return 'null';
  if (typeof value.value === 'string') return value.value;
  if (value.type === 'Ljava/lang/String;' || isReference(value.type)) { const rendered = dbg.render(value, { depth: 0 }); return typeof rendered === 'string' ? rendered : rendered?.$type ?? 'object'; }
  if (value.type === 'Z') return value.value ? 'true' : 'false';
  if (value.type === 'C') return String.fromCharCode(value.value);
  return String(value.value);
}
function shortText(rendered) {
  if (rendered === null) return 'null';
  if (typeof rendered === 'string') return JSON.stringify(rendered);
  if (typeof rendered !== 'object') return String(rendered);
  if (rendered.$kind === 'array') return `${rendered.$type}(${rendered.size})`;
  return rendered.$type ? `${rendered.$type}${rendered.$handle ? ` ${rendered.$handle}` : ''}` : JSON.stringify(rendered).slice(0, 200);
}
function parseHitCondition(text) {
  const source = String(text).trim(), match = /^(>=|==|%|>)?\s*(\d+)$/.exec(source);
  if (!match) fail('bad-args', `Hit condition: "N", ">= N", "> N", "== N" or "% N" (got ${source.slice(0, 40)})`);
  const n = Number(match[2]), op = match[1] ?? '>=';
  if (op === '%' && n === 0) fail('bad-args', 'Hit condition "% 0"');
  return { text: `${op} ${n}`, test: hits => op === '>=' ? hits >= n : op === '>' ? hits > n : op === '==' ? hits === n : hits % n === 0 };
}
function parseLogMessage(text) {
  const parts = []; let at = 0;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    if (open < 0) { parts.push(text.slice(at)); break; }
    if (open > at) parts.push(text.slice(at, open));
    const close = text.indexOf('}', open);
    if (close < 0) fail('bad-args', 'Log message: an unclosed {');
    parts.push(parseExpression(text.slice(open + 1, close))); at = close + 1;
  }
  return parts;
}

// ---- the JavaScript interpreter's side (src/interpreter.js) ----------------------------------------------------------------------------------------------------------
// A breakpoint: the method's decoded code units become a copy (prog.units, kept for the debugger's whole session) with opcode 0x73 at the armed address, and the method stays
// interpreted (prog.debug: no compiled or direct form, no frameless getter or shape at its call sites). Passing a breakpoint: the original word goes back for one instruction and
// APKRuntime.debugRearm's probe writes the breakpoint back before the next one runs (the run loop reads that probe in place of instructionProbe while it is set). A step: the
// instruction probe asks stepWants before every interpreted instruction of the stepping thread, with every compiled and direct form set aside meanwhile, so that every frame of
// the thread is seen by the probe (the forms come back when the step ends).
class JsDebugAdapter {
  constructor(dbg) { this.dbg = dbg; this.rt = dbg.rt; this.copies = new Map(); this.aside = null; this.stepProbe = null; this.defs = new WeakMap(); }
  /** The class record's method entry of a decoded method (kept aside: the prog objects keep their shape). */
  def(prog) { let definition = this.defs.get(prog); if (definition === undefined) { definition = this.definitionOf(prog); this.defs.set(prog, definition); } return definition; }
  siteKey(prog, pc) { return `${prog.dex?.filename ?? 'dex'}|${prog.key}@${pc}`; }
  targetOf(definition) { return definition.code?.progs?.get?.(this.rt) ?? null; }
  originalUnits(definition) { const prog = this.targetOf(definition); if (prog) return this.copies.get(prog)?.units ?? prog.units; const code = definition.code, reader = definition.method.dex.reader; return Uint16Array.from({ length: code.units }, (_, i) => reader.view.getUint16(code.offset + i * 2, true)); }
  /** interpreter.js prepareCore: a method's code was decoded. */
  prepared(prog) { const dbg = this.dbg; if ((dbg.pendingByOwner.get(prog.method.owner)?.size ?? 0) > 0 || dbg.fieldWatches.size) dbg.methodReady(prog.key, this.def(prog), prog); }
  definitionOf(prog) {
    const method = prog.method; let cls = null; try { cls = this.rt.classes.get(method.owner); } catch { cls = null; }
    const definition = cls?.methods?.get(method.name + method.signature) ?? null;
    return definition && definition.code === prog.code ? definition : { method, flags: (definition?.flags ?? 0), code: prog.code };
  }
  debugProg(prog) {
    if (this.copies.has(prog)) return;
    this.copies.set(prog, { units: prog.units, fn: prog.fn, d: prog.d, getter: prog.getter, shape: prog.shape, noDirect: prog.noDirect });
    prog.units = Uint16Array.from(prog.units); prog.debug = true; prog.fn = null; prog.d = null; prog.getter = null; prog.shape = null; prog.noDirect = true;
    if (this.aside?.has(prog)) this.aside.delete(prog);
  }
  arm(site) { const prog = site.target; this.debugProg(prog); const word = prog.units[site.pc]; if ((word & 255) === DEBUG_OPCODE) return; site.orig = word; prog.units[site.pc] = (word & 0xff00) | DEBUG_OPCODE; }
  disarm(site) { const prog = site.target; if ((prog.units[site.pc] & 255) === DEBUG_OPCODE) prog.units[site.pc] = site.orig; }
  passOver(prog, pc, thread, frame) {
    const site = this.dbg.sites.get(this.siteKey(prog, pc)), original = site?.armed ? site.orig : this.copies.get(prog)?.units[pc];
    if (original === undefined) return false;
    prog.units[pc] = original;
    if (!site?.armed) return true;   // removed meanwhile: nothing to write back
    const rt = this.rt, dbg = this.dbg, rearm = { thread, frame, pc, prog, site, probe: null };
    rearm.probe = (method, dex, at, op, word) => {
      if (rt.debugRearm === rearm) {
        const top = rt.thread?.frames[rt.thread.frames.length - 1];
        if (!(rt.thread === thread && top === frame && at === pc)) {   // the instruction ran (or another thread runs now): the breakpoint goes back
          if (site.armed && (prog.units[pc] & 255) !== DEBUG_OPCODE) prog.units[pc] = (site.orig & 0xff00) | DEBUG_OPCODE;
          if (frame.pc === pc && top !== frame) dbg.passMarks.set(frame, pc);   // the instruction waits to be run again (a monitor, a class initialization): it passes the breakpoint then
          rt.debugRearm = null;
        }
      }
      return rt.instructionProbe ? rt.instructionProbe(method, dex, at, op, word) : undefined;
    };
    rt.debugRearm = rearm;
    return true;
  }
  /** A frame as the debugger sees it. */
  frameOf(thread, frame, index, depth, top) {
    if (frame.cont !== undefined) return { host: true, key: frame.cont?.method?.key ?? null, depth };
    const prog = frame.prog, definition = prog ? this.def(prog) : null;
    return { frame, key: prog?.key ?? frame.method?.key, definition, pc: top ? frame.pc : frame.callPc, depth, registers: frame.code?.registers ?? 0, ins: frame.code?.incoming ?? 0, compiled: frame.busy === true, thread };
  }
  frames(thread) {
    const frames = thread.frames ?? [], out = [];
    // the top frame's pc: where it stopped (a debugger stop, a yield, a monitor-enter to run again) -- or, inside a call that waits (a host native's Blocked), the call itself
    const inCall = !this.dbg.stops.has(thread) && thread.blocked !== null && thread.blocked !== undefined && thread.blocked.retry !== true;
    for (let i = frames.length - 1; i >= 0; i--) out.push(this.frameOf(thread, frames[i], out.length, i + 1, i === frames.length - 1 && !inCall));
    return out;
  }
  whereOf(thread, frame, pc) {
    const prog = frame.prog, definition = this.def(prog), info = debugInfoOf(definition), line = lineAt(info, pc);
    return { thread, frame, frameRef: frame, target: prog, pc, method: prog.key, definition, depth: thread.frames.length, line, lineStart: isLineStart(info, pc), hasLines: !!info?.lines.length, location: this.dbg.location(prog.key, definition, pc), registers: frame.code.registers, ins: frame.code.incoming };
  }
  readRaw(frame, register) { const v = frame.frame.regs[register]; return v; }
  readWide(frame, register) { const v = frame.frame.regs[register]; return typeof v === 'bigint' ? BigInt.asIntN(64, v) : BigInt(v ?? 0); }
  reference(raw) { return raw === undefined || raw === 0 ? null : raw; }
  /** A register with no declared type: what the JavaScript VM's value says it is. */
  untyped(frame, register, raw) {
    if (raw === undefined) return null;
    if (raw === null) return { type: 'null', value: null };
    if (typeof raw === 'string') return { type: 'Ljava/lang/String;', value: raw };
    if (typeof raw === 'bigint') return { type: 'J', value: BigInt.asIntN(64, raw) };
    if (typeof raw === 'object' && typeof raw.ref === 'number') { const rec = this.rt.heap.get(raw.ref); return { type: rec?.type ?? 'Ljava/lang/Object;', value: raw }; }
    if (typeof raw === 'number') return { type: 'I', value: raw | 0 };
    return null;
  }
  write(frame, register, typed) {
    const regs = frame.frame.regs;
    if (typed.type === 'J' || typed.type === 'D') { regs[register] = typed.type === 'J' ? BigInt.asIntN(64, typed.value) : doubleToBits(typed.value); regs[register + 1] = WIDE_HIGH; return; }
    if (typed.type === 'F') { regs[register] = floatToBits(typed.value); return; }
    if (isReference(typed.type)) { regs[register] = typed.value === null ? null : typed.value; return; }
    regs[register] = typed.value | 0;
  }
  exceptionOf(thread, error) {
    const value = error?.value, rec = value && typeof value === 'object' ? this.rt.heap.get(value.ref) : null, type = rec?.type ?? (typeof value === 'string' ? 'Ljava/lang/String;' : 'Ljava/lang/Throwable;');
    let message = null; try { message = this.rt.describeThrowable?.(value)?.message ?? rec?.message ?? null; } catch { message = rec?.message ?? null; }
    return { descriptor: type, type: dotted(type), message, handle: rec ? handleOf(this.rt, rec.id ?? value.ref) : null };
  }
  /** The frame that catches the exception, as the unwinding will find it; null when it leaves this run's Java frames (into host code, or uncaught). */
  catchOf(thread, frame, pc, error) {
    const frames = thread.frames, bases = thread.debugBases ?? [], base = bases.length ? bases[bases.length - 1] : 0;
    for (let i = frames.length - 1, at = pc; i >= base; i--) {
      const f = frames[i]; if (f.cont !== undefined) return null;
      if (f.busy) return null;
      let target = null; try { target = debugCatchTarget(this.rt, f, at, error.value); } catch { target = null; }
      if (target !== null) { const where = this.frameOf(thread, f, 0, i + 1, false); return { depth: i + 1, pc: target, location: this.dbg.location(where.key, where.definition, target) }; }
      at = frames[i - 1]?.callPc ?? 0;
    }
    return null;
  }
  refreshExceptions() { /* the interpreter asks wantsThrow at every throw */ }
  accessMatches(bp, where, pc) {
    const prog = where.target, op = this.copies.get(prog)?.units[pc] & 255, index = prog.units[pc + 1];
    if (bp.access === 'read' && !FIELD_READ(op)) return false; if (bp.access === 'write' && !FIELD_WRITE(op)) return false;
    try { const field = this.rt.resolveField(prog.dex.field(index)); return field.owner === bp.declaringOwner || (field.name === bp.field && this.dbg.isSubtype(field.owner, bp.owner)); } catch { return false; }
  }
  armWatch(bp) {
    bp.declaringOwner = null;
    try { const cls = this.rt.classes.get(bp.owner); for (const entry of [...(cls?.fields ?? []), ...(cls?.staticFields ?? [])]) { const field = cls.dex.field(entry.index); if (field.name === bp.field) bp.declaringOwner = field.owner; } } catch { /* pending */ }
    for (const prog of this.rt.allProgs ?? []) this.watchIn(bp, prog.key, this.def(prog), prog);
  }
  watchIn(bp, key, definition, prog) {
    const units = this.copies.get(prog)?.units ?? prog.units, dex = prog.dex;
    for (const pc of instructionStarts(units)) {
      const op = units[pc] & 255; if (!FIELD_READ(op) && !FIELD_WRITE(op)) continue;
      if ((bp.access === 'read' && !FIELD_READ(op)) || (bp.access === 'write' && !FIELD_WRITE(op))) continue;
      let field; try { field = dex.field(units[pc + 1]); } catch { continue; }
      if (field.name !== bp.field || !(field.owner === bp.owner || this.dbg.isSubtype(field.owner, bp.owner) || this.dbg.isSubtype(bp.owner, field.owner))) continue;
      this.dbg.placeAt(bp, key, definition, prog, [pc]);
    }
  }
  /** The JavaScript VM's form of a returned value (interpreter.js returnValue). */
  returnValue(typed) {
    if (typed.type === 'V') return undefined;
    if (typed.type === 'J') return BigInt.asIntN(64, typed.value);
    if (typed.type === 'D') return doubleToBits(typed.value);
    if (typed.type === 'F') return floatToBits(typed.value);
    if (isReference(typed.type)) return typed.value === null ? null : typed.value;
    return typed.value | 0;
  }
  /** A parked or held frame sees its early return at its next instruction: a temporary breakpoint there (the run loop asks takeReturn at a breakpoint). */
  armReturn(thread, top, entry) {
    const prog = top.frame.prog, reason = { kind: 'early-return', thread, enabled: true };
    const site = this.dbg.siteFor(prog.key, top.definition, prog, top.pc); site.reasons.add(reason); this.dbg.arm(site);
    entry.site = site; entry.reason = reason;
  }
  // ---- steps: the probe sees every instruction the interpreter runs; compiled and direct forms are set aside while a step is in progress
  beginStep(thread, step, top) {
    const rt = this.rt;
    if (this.aside === null) {
      this.aside = new Map();
      for (const prog of rt.allProgs ?? []) if ((prog.fn !== null || prog.d !== null) && !this.copies.has(prog)) { this.aside.set(prog, { fn: prog.fn, d: prog.d, getter: prog.getter, shape: prog.shape }); prog.fn = null; prog.d = null; prog.getter = null; prog.shape = null; }
    }
    if (this.stepProbe === null) {
      const dbg = this.dbg;
      this.previousProbe = rt.instructionProbe;
      this.stepProbe = (method, dex, pc) => {
        const thread = rt.thread, step = dbg.stepsByThread.get(thread); if (!step) return false;
        const frames = thread.frames, top = frames[frames.length - 1]; if (!top || top.prog === undefined) return false;
        const where = this.whereOf(thread, top, pc);
        return dbg.stepWants(step, where) === 'stop';
      };
      rt.instructionProbe = this.stepProbe;
    }
  }
  endStep() {
    if (this.dbg.stepsByThread.size) return;
    const rt = this.rt;
    if (this.stepProbe !== null) { if (rt.instructionProbe === this.stepProbe) rt.instructionProbe = this.previousProbe; this.stepProbe = null; }
    if (this.aside !== null) { for (const [prog, saved] of this.aside) if (!this.copies.has(prog)) Object.assign(prog, saved); this.aside = null; }
  }
  detach() {
    for (const [prog, saved] of this.copies) { prog.units = saved.units; prog.fn = saved.fn; prog.d = saved.d; prog.getter = saved.getter; prog.shape = saved.shape; prog.noDirect = saved.noDirect; prog.debug = false; }
    this.copies.clear();
    this.endStep();
  }
}
