// The WebAssembly core's side of the Java debugger (src/debugger.js, docs/DEBUGGER.md). The core knows three debugger statuses (vmcore/abi.h), each of which keeps the frames:
//   BREAKPOINT       the instruction at Thread.pc has the debugger's opcode (0x73) written over its opcode byte in the method's linked code (arm below). resume() runs the
//                    original instruction once when Thread.debugPc names that address (Thread.debugWord: its opcode byte): the breakpoint stays in place.
//   STEPPED          a single step ended (Thread.debugFlags DEBUG_STEP: the instruction budget Thread.maxSteps is set one past the current count, and the instruction that
//                    would pass it stops the run instead of running). Steps over and out of a call run the call at full speed: a temporary breakpoint at the return address,
//                    tied to the caller's frame (src/debugger.js 'step-return'), and DEBUG_EXCEPTIONS while it is armed so that an exception that unwinds past it ends the step at its handler.
//   EXCEPTION_EVENT  DEBUG_EXCEPTIONS: a thrown exception, before it is unwound (Thread.result; Thread.throwing set: resume() unwinds it; the core does not report it twice).
// vmcore/js/core-threads.js advance() hands the three to coreStop (park the thread, or go on) and continueFrom (resume past the stop). Frames are read from the thread record's
// stack in linear memory (abi.h: frame[0] caller, frame[1] return pc, frame[2] Method, then the registers); the runs nested below the innermost one (host steps on the record,
// runs host code waits for on the JavaScript stack) are found from what their callers kept (thread.core.steps 'run' entries, thread.debugOuter).
import { METHOD } from './linker.js?v=8411deb8def1';

const T = { steps: 32, maxSteps: 40, result: 48, frame: 2132, pc: 2136, depth: 2140, debugFlags: 2208, debugPc: 2212, debugWord: 2216, debugThrown: 2220 };
const M_CLINIT = 4, OPCODE = 0x73, DEBUG_STEP = 1, DEBUG_EXCEPTIONS = 2, NO_BUDGET = 1n << 60n;
export const DEBUG_STATUS = Object.freeze({ BREAKPOINT: 96, STEPPED: 97, EXCEPTION_EVENT: 98 });
const FIELD_READ = op => (op >= 0x52 && op <= 0x58) || (op >= 0x60 && op <= 0x66), FIELD_WRITE = op => (op >= 0x59 && op <= 0x5f) || (op >= 0x67 && op <= 0x6d);

export class CoreDebugAdapter {
  constructor(engine, dbg) {
    this.engine = engine; this.dbg = dbg; this.rt = engine.runtime; this.linker = engine.linker; this.byAddress = new Map(); this.exceptionsOn = false;
    this.linker.onLinked = mi => this.linked(mi);
  }
  get u32() { return this.engine.u32; }
  get u16() { const buffer = this.engine.memory.buffer; if (this.u16view === undefined || this.u16view.buffer !== buffer) this.u16view = new Uint16Array(buffer); return this.u16view; }
  r32(at) { return this.u32[at >>> 2]; }
  w32(at, value) { this.u32[at >>> 2] = value >>> 0; }
  codeOf(mi) { return this.r32(mi.address + METHOD.code); }
  linkedCode(mi) { return this.codeOf(mi) !== 0 && this.r32(mi.address + METHOD.kind) === 0; }

  // ---- sites
  siteKey(mi, pc) { return `m${mi.id}@${pc}`; }
  /** The laid-out method of a definition when its code is linked (null: pending until linker.linkCode). Never lays out a class (that is the app's code reaching it). */
  targetOf(definition) {
    const info = this.linker.classes.get(definition.method.owner), mi = info?.methods?.get(definition.method.name + definition.method.signature);
    return mi && mi.def === definition && this.linkedCode(mi) ? mi : null;
  }
  linked(mi) { const dbg = this.dbg; if (mi.def?.code && ((dbg.pendingByOwner.get(mi.def.method.owner)?.size ?? 0) > 0 || dbg.fieldWatches.size)) dbg.methodReady(mi.key, mi.def, mi); }
  originalUnits(definition) {
    const mi = this.targetOf(definition); if (mi?.original) return mi.original;
    const code = definition.code, view = definition.method.dex.reader.view;
    return Uint16Array.from({ length: code.units }, (_, i) => view.getUint16(code.offset + i * 2, true));
  }
  arm(site) {
    const at = this.codeOf(site.target) + 2 * site.pc, u16 = this.u16, word = u16[at >>> 1];
    if ((word & 255) === OPCODE) return;
    site.orig = word; site.address = at; u16[at >>> 1] = (word & 0xff00) | OPCODE; this.byAddress.set(at, site);
  }
  disarm(site) {
    const at = site.address ?? this.codeOf(site.target) + 2 * site.pc, u16 = this.u16;
    if ((u16[at >>> 1] & 255) === OPCODE) u16[at >>> 1] = site.orig;
    this.byAddress.delete(at);
  }

  // ---- frames
  /** One chain of frames from (fp, pc address) at call depth `depth`, innermost first, into `out`. */
  chain(thread, fp, pcAddress, depth, out) {
    const methodsAt = this.linker.methodsAt;
    for (let first = true, guard = 0; fp && guard < 4096; guard++) {
      const methodAddress = this.r32(fp + 8), mi = methodsAt.get(methodAddress); if (!mi) break;
      const code = this.r32(methodAddress + METHOD.code), pc = code ? (pcAddress - code) >> 1 : 0;
      out.push({ frame: fp, mi, key: mi.key, definition: mi.def, pc, depth, registers: mi.registers, ins: mi.ins, regsAt: fp + 12, thread, pending: !first && false });
      const caller = this.r32(fp), ret = this.r32(fp + 4);
      if (!caller) break;
      const clinit = (this.r32(methodAddress + METHOD.flags) & M_CLINIT) !== 0;
      pcAddress = clinit ? (ret & ~1) : (ret & ~1) - 6;   // exceptions.h exc_call_pc: the caller's invoke (or the instruction a <clinit> started from)
      fp = caller; depth--; first = false;
    }
  }
  frames(thread) {
    const t = thread.core?.t; if (t === undefined) return [];
    const out = [], frame = this.r32(t + T.frame);
    if (frame) this.chain(thread, frame, this.r32(t + T.pc), this.r32(t + T.depth), out);
    const steps = thread.core.steps ?? [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.kind === 'run' && step.saved?.frame) this.chain(thread, step.saved.frame, step.saved.pc, step.saved.depth, out);
      else if (step.kind === 'invoke' || step.kind === 'wait') out.push({ host: true, key: step.invoke?.method?.key ?? null, depth: out.at(-1)?.depth ?? 0 });
    }
    const outer = thread.debugOuter;
    if (outer) for (let i = outer.length - 3; i >= 0; i -= 3) { out.push({ host: true, key: null, depth: outer[i + 2] }); if (outer[i]) this.chain(thread, outer[i], outer[i + 1], outer[i + 2], out); }
    return out;
  }
  whereOf(thread, entry, pc) {
    const dbg = this.dbg, definition = entry.definition, info = dbg.constructor.debugInfo(definition), line = dbg.constructor.lineAt(info, pc);
    return { ...entry, thread, frameRef: entry, target: entry.mi, pc, method: entry.key, line, lineStart: dbg.constructor.isLineStart(info, pc), hasLines: !!info?.lines.length, location: dbg.location(entry.key, definition, pc) };
  }
  readRaw(entry, register) { return this.u32[(entry.regsAt >>> 2) + register]; }
  readWide(entry, register) { const at = (entry.regsAt >>> 2) + register; return BigInt.asIntN(64, BigInt(this.u32[at]) | BigInt(this.u32[at + 1]) << 32n); }
  isObject(word) { return word !== 0 && this.engine.x.gc_is_object(this.engine.h, word) !== 0; }
  reference(raw) { if (!raw) return null; if (!this.isObject(raw)) throw new Error('not a reference'); return this.engine.refValue(raw); }
  untyped(entry, register, raw) {
    if (raw === undefined) return null;
    if (raw !== 0 && this.isObject(raw)) { const value = this.engine.refValue(raw); const rec = typeof value === 'string' ? null : this.rt.heap.get(value.ref); return { type: typeof value === 'string' ? 'Ljava/lang/String;' : rec?.type ?? 'Ljava/lang/Object;', value }; }
    return { type: 'I', value: raw | 0 };
  }
  write(entry, register, typed) {
    const at = entry.regsAt + 4 * register;
    if (typed.type === 'J' || typed.type === 'D') { const bits = typed.type === 'J' ? BigInt.asUintN(64, typed.value) : BigInt.asUintN(64, doubleBits(typed.value)); this.w32(at, Number(bits & 0xffffffffn)); this.w32(at + 4, Number(bits >> 32n)); return; }
    if (typed.type === 'F') { this.w32(at, floatBits(typed.value)); return; }
    if (typed.type === 'null' || typed.type[0] === 'L' || typed.type[0] === '[') { this.w32(at, typed.value === null ? 0 : this.engine.refWord(typed.value)); return; }
    this.w32(at, typed.value | 0);
  }
  mark() { return this.engine.pins.length; }
  release(mark) { if (mark !== undefined && this.engine.pins.length > mark) this.engine.pins.length = mark; }

  // ---- exceptions
  exceptionOf(thread, address) {
    const value = address ? this.engine.refValue(address) : null, rec = value && typeof value === 'object' ? this.rt.heap.get(value.ref) : null, type = rec?.type ?? 'Ljava/lang/Throwable;';
    return { descriptor: type, type: type.replace(/^L|;$/g, '').replaceAll('/', '.'), message: address ? this.engine.messageOf(address) : null, handle: rec ? this.dbg.handleOf(rec.id ?? value.ref) : null };
  }
  catchOf(thread, entry) {
    const t = thread.core.t, out = this.engine.stackScratch, found = this.engine.x.debug_catch(t, out) >>> 0;
    if (found !== 1) return null;
    const frames = this.r32(out), pc = this.r32(out + 4), fp = this.r32(out + 8), mi = this.linker.methodsAt.get(this.r32(fp + 8));
    return { depth: entry.depth - frames, frame: fp, pc, location: mi ? this.dbg.location(mi.key, mi.def, pc) : null };
  }
  refreshExceptions(on) {
    this.exceptionsOn = on;
    for (const thread of this.dbg.allThreads()) this.bound(thread);
  }
  /** A record's debug flags for its thread (core-threads.js bind: a new thread gets them too). */
  bound(thread) {
    const t = thread.core?.t; if (t === undefined) return;
    const step = this.dbg.stepsByThread.get(thread), flags = this.r32(t + T.debugFlags);
    const want = this.exceptionsOn || step?.exceptions === true;
    this.w32(t + T.debugFlags, want ? flags | DEBUG_EXCEPTIONS : flags & ~DEBUG_EXCEPTIONS);
  }
  threadStarted(thread) { this.bound(thread); }
  accessMatches(bp, where, pc) {
    const units = where.mi.original, op = units?.[pc] & 255; if (units === undefined) return false;
    if (bp.access === 'read' && !FIELD_READ(op)) return false; if (bp.access === 'write' && !FIELD_WRITE(op)) return false;
    try { const field = this.rt.resolveField(where.definition.method.dex.field(units[pc + 1])); return field.name === bp.field && (field.owner === bp.owner || this.dbg.isSubtype(field.owner, bp.owner) || this.dbg.isSubtype(bp.owner, field.owner)); } catch { return false; }
  }
  armWatch(bp) { for (const mi of this.linker.methodList) if (mi?.def?.code && this.linkedCode(mi)) this.watchIn(bp, mi.key, mi.def, mi); }
  watchIn(bp, key, definition, mi) {
    const units = mi.original ?? this.originalUnits(definition), dex = definition.method.dex, starts = this.dbg.constructor.instructionStarts(units);
    for (const pc of starts) {
      const op = units[pc] & 255; if (!FIELD_READ(op) && !FIELD_WRITE(op)) continue;
      if ((bp.access === 'read' && !FIELD_READ(op)) || (bp.access === 'write' && !FIELD_WRITE(op))) continue;
      let field; try { field = dex.field(units[pc + 1]); } catch { continue; }
      if (field.name !== bp.field || !(field.owner === bp.owner || this.dbg.isSubtype(field.owner, bp.owner) || this.dbg.isSubtype(bp.owner, field.owner))) continue;
      this.dbg.placeAt(bp, key, definition, mi, [pc]);
    }
  }

  // ---- stops (core-threads.js advance)
  /** A run stopped with a debugger status: true parks the thread (the debugger's Blocked); false: continueFrom goes on. */
  coreStop(thread, owner, status) {
    const t = thread.core.t, rt = this.rt, sched = rt.scheduler;
    if (status === DEBUG_STATUS.STEPPED) this.singleStep(t, false);
    const top = this.frames(thread)[0];
    if (!top || top.host) return false;
    const kind = status === DEBUG_STATUS.BREAKPOINT ? 'breakpoint' : status === DEBUG_STATUS.STEPPED ? 'step' : 'exception';
    const thrown = kind === 'exception' ? this.r32(t + T.result) : null;
    const parkable = (owner === null && rt.nestedRuns === 1) || (owner === thread && thread === sched.main && this.engine.maySuspend(thread));
    this.lastStatus = status;
    return this.dbg.stop(thread, top, top.pc, parkable, kind, thrown);
  }
  /** Resumes past a debugger stop: a breakpoint's instruction runs once; a step in progress is armed again. Returns the run's next status. */
  continueFrom(thread, status) {
    const t = thread.core.t, x = this.engine.x;
    if (status === DEBUG_STATUS.BREAKPOINT) {
      const at = this.r32(t + T.pc), word = this.u16[at >>> 1];
      if ((word & 255) === OPCODE) { const site = this.byAddress.get(at); if (site) { this.w32(t + T.debugPc, at); this.w32(t + T.debugWord, site.orig & 255); } }
    }
    const early = this.dbg.returns.size ? this.dbg.takeReturn(thread, this.r32(t + T.frame)) : undefined;
    if (early !== undefined) {   // force-early-return: the top frame returns this value now (interp.c debug_return)
      const typed = early.typed, bits = typed.type === 'V' ? 0n : typed.type === 'J' ? BigInt.asUintN(64, typed.value) : typed.type === 'D' ? BigInt.asUintN(64, doubleBits(typed.value)) : BigInt(typed.type === 'F' ? floatBits(typed.value) >>> 0 : (typed.type === 'null' || typed.type[0] === 'L' || typed.type[0] === '[') ? (typed.value === null ? 0 : this.engine.refWord(typed.value)) : typed.value >>> 0);
      this.w32(t + T.debugPc, 0);
      return x.debug_return(t, Number(bits & 0xffffffffn), Number(bits >> 32n)) >>> 0;
    }
    const step = this.dbg.stepsByThread.get(thread);
    if (step) this.armStep(thread, step, status);
    return x.resume(t) >>> 0;
  }
  singleStep(t, on, immediate = false) {
    const view = this.engine.view, flags = this.r32(t + T.debugFlags);
    if (on) { this.w32(t + T.debugFlags, flags | DEBUG_STEP); view.setBigUint64(t + T.maxSteps, view.getBigUint64(t + T.steps, true) + (immediate ? 0n : 1n), true); }
    else { this.w32(t + T.debugFlags, flags & ~DEBUG_STEP); view.setBigUint64(t + T.maxSteps, NO_BUDGET, true); }
  }
  beginStep(thread, step) { step.core = { status: null }; }
  /** The step goes on from the thread's current stop: one instruction at a time, or -- inside a call a step over or out does not stop in -- at full speed to its return. */
  armStep(thread, step, status) {
    const t = thread.core.t;
    if (step.returnSite) { this.singleStep(t, false); return; }
    const frames = this.frames(thread), top = frames[0], callerDepth = step.kind === 'out' ? step.depth - 1 : step.depth;
    if ((step.started || step.kind === 'out') && step.kind !== 'into' && top && top.depth > callerDepth) {
      const index = frames.findIndex(entry => !entry.host && entry.depth === callerDepth), callee = frames[index - 1], caller = frames[index];
      if (index > 0 && callee && !callee.host && caller.frame === this.r32(callee.frame)) {
        const ret = this.r32(callee.frame + 4) & ~1, code = this.codeOf(caller.mi), pc = (ret - code) >> 1;
        const reason = { kind: 'step-return', thread, frame: caller.frame, enabled: true, sites: [] };
        const site = this.dbg.siteFor(caller.key, caller.definition, caller.mi, pc); site.reasons.add(reason); reason.sites.push(site); this.dbg.arm(site);
        step.returnSite = reason; step.exceptions = true; this.bound(thread);
        this.singleStep(t, false);
        return;
      }
    }
    this.singleStep(t, true, status === DEBUG_STATUS.EXCEPTION_EVENT);
  }
  /** An exception during a step: wherever it is caught, the step looks at the handler's first instruction (the run-to-return breakpoint may never be reached). */
  stepThrow(thread, step) {
    if (step.returnSite) { this.dbg.dropTemp(step.returnSite); step.returnSite = null; }
    step.exceptions = false; step.started = true; this.bound(thread);
    this.singleStep(thread.core.t, true, true);
  }
  endStep(thread, step) {
    const t = thread?.core?.t; if (t === undefined) return;
    this.singleStep(t, false);
    if (step) step.exceptions = false;
    this.bound(thread);
  }
  detach() {
    this.linker.onLinked = null;
    for (const thread of this.dbg.allThreads()) { const t = thread.core?.t; if (t === undefined) continue; this.singleStep(t, false); this.w32(t + T.debugFlags, 0); }
    this.byAddress.clear();
  }
}

const bits = new DataView(new ArrayBuffer(8));
function floatBits(value) { bits.setFloat32(0, value, true); return bits.getInt32(0, true); }
function doubleBits(value) { bits.setFloat64(0, value, true); return bits.getBigInt64(0, true); }
