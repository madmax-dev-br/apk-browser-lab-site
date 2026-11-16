// Baseline compiler: turns a hot DEX method into a JavaScript function that executes the same instructions over the same frame (Frame.regs / pc / result), so the interpreter
// loop and compiled code can hand a frame back and forth at any instruction boundary.
//
// What is compiled: everything that cannot leave the frame -- moves, constants, arithmetic (the 23x and 2addr binops, long arithmetic and float/double add/sub/mul/div inline),
// comparisons, branches and switches, array and field access, allocation, casts -- and calls whose target the interpreter has resolved at that site: a cached DEX callee (the site's
// first receiver class, or another one through its polymorphic cache) is entered directly, a SHIM/platform bridge is called (H.bridgeCall). What is left to the interpreter loop:
// returns (the compiled function returns RET), calls it has not resolved, throw, monitor-enter/exit, filled-new-array, fill-array-data. The compiled function runs until it reaches
// one of those instructions (it stores that pc in frame.pc and returns EXIT), or reaches a backward branch when the thread's instruction quantum is used up (YIELD, so another thread
// can run). The interpreter then executes the one instruction and re-enters the compiled code at the next pc. A bridge that answers a frame to push, a wait or a host step hands that
// outcome to the interpreter's invoke (frame.handoff), so frames are still pushed, parked and unwound by the loop and a compiled method can block, be preempted, throw and unwind like
// an interpreted one.
//
// Exactness: instruction counts (rt.steps, executionByOrigin) are maintained per instruction; a throwing instruction records its pc (frame.cur) so exception tables apply as in
// the interpreter. Operand checks the interpreter performs on every access (register initialised, int/wide type) are not repeated here: they guard against a malformed DEX or an
// interpreter bug, not against Java semantics, and the verifier-clean code of an APK cannot trigger them.

const STRING_INTRINSICS = {
  'Ljava/lang/String;->length()I': `n++; f.result = a0.length; pc = ${'${PC_NEXT}'}; continue;`,
  'Ljava/lang/String;->isEmpty()Z': `n++; f.result = a0.length === 0 ? 1 : 0; pc = ${'${PC_NEXT}'}; continue;`,
  'Ljava/lang/String;->charAt(I)C': `const i = a1 | 0; if (i >= 0 && i < a0.length) { n++; f.result = a0.charCodeAt(i); pc = ${'${PC_NEXT}'}; continue; }`,
  'Ljava/lang/String;->equals(Ljava/lang/Object;)Z': `n++; f.result = a0 === a1 ? 1 : 0; pc = ${'${PC_NEXT}'}; continue;`,
  'Ljava/lang/String;->startsWith(Ljava/lang/String;)Z': `if (typeof a1 === 'string') { n++; f.result = a0.startsWith(a1) ? 1 : 0; pc = ${'${PC_NEXT}'}; continue; }`,
};
export const EXIT = 1, YIELD = 2, CALL = 3, RET = 4;
export const MAX_COMPILED_UNITS = 6000;
export const DIRECT_DEPTH = 96;   // direct activations (JavaScript stack frames) one chain may hold before it is rebuilt as frames (H.poll)

const UNITS = new Uint8Array(256).fill(0);
for (const op of [0x00, 0x01, 0x04, 0x07, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x1d, 0x1e, 0x21, 0x27, 0x28]) UNITS[op] = 1;
for (let op = 0x7b; op <= 0x8f; op++) UNITS[op] = 1;
for (let op = 0xb0; op <= 0xcf; op++) UNITS[op] = 1;
for (let op = 0x90; op <= 0xaf; op++) UNITS[op] = 2;   // binop vAA, vBB, vCC (format 23x)
for (const op of [0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f, 0x20, 0x22, 0x23, 0x29]) UNITS[op] = 2;
for (let op = 0x2d; op <= 0x3d; op++) UNITS[op] = 2;
for (let op = 0x44; op <= 0x6d; op++) UNITS[op] = 2;
for (let op = 0xd0; op <= 0xe2; op++) UNITS[op] = 2;
for (const op of [0x03, 0x06, 0x09, 0x14, 0x17, 0x1b, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2c]) UNITS[op] = 3;
for (let op = 0x6e; op <= 0x72; op++) UNITS[op] = 3;
for (let op = 0x74; op <= 0x78; op++) UNITS[op] = 3;
UNITS[0x18] = 5;
const EXITS = new Set([0x1d, 0x1e, 0x24, 0x25, 0x26, 0x27]);   // left to the interpreter loop
const INVOKES = new Set([0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78]);
const RETURNS = new Set([0x0e, 0x0f, 0x10, 0x11]);
const THROWING = new Set([0x1c, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51]);
for (let op = 0x52; op <= 0x6d; op++) THROWING.add(op);

const signed16 = n => (n << 16) >> 16, signed8 = n => (n << 24) >> 24;
/** The record of the reference in register expression `reg`, as rt.vmObject(reg) (which also raises the NullPointerException or the invalid-reference report): the heap lookup inline. */
const OBJECT = (name, reg) => `const ${name}r = ${reg}; let ${name} = ${name}r !== null && typeof ${name}r === 'object' ? rt.heap.get(${name}r.ref) : undefined; if (${name} === undefined) ${name} = rt.vmObject(${name}r);`;
/** The array record for an access at `index`, as rt.vmArray(reg, index) (null, invalid reference, not an array, index out of bounds raise there): the in-bounds case inline. */
const ARRAY = (name, reg, index) => `const ${name}r = ${reg}; let ${name} = ${name}r !== null && typeof ${name}r === 'object' ? rt.heap.get(${name}r.ref) : undefined; if (${name} === undefined || ${name}.cells === undefined || !(${index} >= 0 && ${index} < ${name}.cells.length)) ${name} = rt.vmArray(${name}r, ${index});`;
/** Long (BigInt) arithmetic of the binop at `operation` (add, sub, mul, and, or, xor, shl, shr, ushr: as longArithmetic) inline; null for div/rem, which go through H.long (division by zero). */
const longBinary = (operation, x, y) => {
  switch (operation) {
    case 0: return `BigInt.asIntN(64, ${x} + ${y})`; case 1: return `BigInt.asIntN(64, ${x} - ${y})`; case 2: return `BigInt.asIntN(64, ${x} * ${y})`;
    case 5: return `(${x} & ${y})`; case 6: return `(${x} | ${y})`; case 7: return `(${x} ^ ${y})`;   // of two 64-bit values: 64-bit already
    case 8: return `BigInt.asIntN(64, ${x} << BigInt(${y} & 63))`; case 9: return `(${x} >> BigInt(${y} & 63))`; case 10: return `BigInt.asIntN(64, BigInt.asUintN(64, ${x}) >> BigInt(${y} & 63))`;
    default: return null;
  }
};
/** The write barrier of a reference store into `target` (a record expression) of the value `val` (heap-gc.js, "Young generation"): an old record that now holds a young reference joins the remembered set. */
const BARRIER = target => `if (${target}.id < rt.gcOldBound && val !== null && typeof val === 'object' && !(val.ref < rt.gcOldBound)) rt.remember(${target});`;

/** Decodes the method into {pc, op, length} records (skipping data payloads) and the set of block leaders; null when it contains an opcode the compiler does not know. */
function scan(u, units, handlerTargets) {
  const instructions = [], leaders = new Set([0, ...handlerTargets]);
  for (let pc = 0; pc < units;) {
    const w = u[pc], op = w & 255;
    if (op === 0x00 && (w >> 8) !== 0) {                              // switch / array payload: skipped, not executable
      const tag = w; let length;
      if (tag === 0x0100) length = 4 + u[pc + 1] * 2; else if (tag === 0x0200) length = 2 + u[pc + 1] * 4; else if (tag === 0x0300) length = 4 + Math.ceil((u[pc + 1] * (u[pc + 2] | (u[pc + 3] << 16))) / 2) ;
      else return null;
      pc += tag === 0x0300 ? 4 + Math.ceil(u[pc + 1] * (u[pc + 2] | (u[pc + 3] << 16)) / 2) : length; continue;
    }
    const length = UNITS[op]; if (length === 0) return null;
    instructions.push({ pc, op, length, w });
    const a = w >> 8;
    if (op === 0x28) leaders.add(pc + signed8(a));
    else if (op === 0x29) leaders.add(pc + signed16(u[pc + 1]));
    else if (op === 0x2a) leaders.add(pc + (u[pc + 1] | (u[pc + 2] << 16)));
    else if ((op >= 0x32 && op <= 0x3d)) { leaders.add(pc + signed16(u[pc + 1])); leaders.add(pc + 2); }
    else if (op === 0x2b || op === 0x2c) { leaders.add(pc + 3); }
    if (EXITS.has(op) || INVOKES.has(op) || RETURNS.has(op) || op === 0x28 || op === 0x29 || op === 0x2a) leaders.add(pc + length);
    pc += length;
  }
  return { instructions, leaders };
}

/**
 * `direct` (tier 2, see the header of the direct form below): the same instruction bodies over JavaScript locals instead of the frame's register array, as a function that takes the
 * method's argument words and returns its value.
 */
export function compileMethod(rt, method, code, prog, tries, support, direct = false) {
  const { units, dex } = prog, u = units;
  const handlerTargets = []; for (const entry of tries) { for (const h of entry.catches) handlerTargets.push(h.address); if (entry.catchAll !== null) handlerTargets.push(entry.catchAll); }
  const decoded = scan(u, code.units, handlerTargets); if (decoded === null) { if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT) console.error(`JIT: ${method.key} stays interpreted: an opcode the compiler does not know`); return null; }
  const { instructions, leaders } = decoded;
  // packed/sparse switch targets are leaders too
  for (const ins of instructions) if (ins.op === 0x2b || ins.op === 0x2c) {
    const payload = ins.pc + (u[ins.pc + 1] | (u[ins.pc + 2] << 16)), size = u[payload + 1], at32 = i => u[i] | (u[i + 1] << 16);
    if (ins.op === 0x2b) for (let i = 0; i < size; i++) leaders.add(ins.pc + at32(payload + 4 + i * 2)); else for (let i = 0; i < size; i++) leaders.add(ins.pc + at32(payload + 2 + size * 2 + i * 2));
  }
  const sites = [];                       // per-site mutable caches shared by the generated code: {field, key, type, ready}
  const site = init => { sites.push(init); return sites.length - 1; };
  const lines = [];
  const emit = s => lines.push(s);
  const R = direct ? n => `v${n}` : n => `r[${n}]`, RES = direct ? 'res' : 'f.result', PEX = direct ? 'pex' : 'f.pendingException';
  const FLUSH = 'rt.steps += n; ST.instructions += n; rt.jitInstructions += n;', REGS = `[${Array.from({ length: code.registers }, (_, i) => `v${i}`).join(', ')}]`;
  const W = 'W';
  const put = (n, e) => `${R(n)} = ${e};`;
  const putWide = (n, e) => `${R(n)} = ${e}; ${R(n + 1)} = W;`;
  const jump = (from, target) => {
    if (target <= from) return direct ? `if (rt.steps + n > rt.maxInstructionsPerEvent) { const max = rt.maxInstructionsPerEvent; n -= rt.steps + n - max - 1; H.fuse(max, rt); } pc = ${target}; if (--rt.q <= 0) H.poll(rt); continue;`
      : `if (rt.steps + n > max) { n -= rt.steps + n - max - 1; H.fuse(max, rt); } if (--rt.q <= 0) { rt.q = ${support.QUANTUM}; f.pc = ${target}; return ${YIELD}; } pc = ${target}; continue;`;
    return `pc = ${target}; continue;`;
  };
  const intBinary = (operation, x, y, fromLiteral) => {
    switch (operation) {
      case 0: return `(${x} + ${y}) | 0`; case 1: return fromLiteral ? `(${y} - ${x}) | 0` : `(${x} - ${y}) | 0`; case 2: return `Math.imul(${x}, ${y})`;
      case 3: return fromLiteral ? `H.arith(3, ${y}, ${x})` : `H.arith(3, ${x}, ${y})`; case 4: return fromLiteral ? `H.arith(4, ${y}, ${x})` : `H.arith(4, ${x}, ${y})`;
      case 5: return `${x} & ${y}`; case 6: return `${x} | ${y}`; case 7: return `${x} ^ ${y}`;
      case 8: return `${x} << (${y} & 31)`; case 9: return `${x} >> (${y} & 31)`; case 10: return `(${x} >>> (${y} & 31)) | 0`;
      default: return null;
    }
  };

  if (direct) {
    const first = code.registers - code.incoming;
    if (code.registers) emit(`let ${Array.from({ length: code.registers }, (_, i) => i >= first ? `v${i} = p${i - first}` : `v${i}`).join(', ')};`);
    // Entry: one test covers a new peak depth, the stack limit, a chain of direct activations that got too deep and a requested safepoint (rt.dlimit, H.deep); the ghost goes on the
    // thread's stack; the call is counted (prog.dc, folded into the VM's counters when the event ends: foldDirectCalls) and enters the trace ring.
    emit(`let pc = -1, n = 0, cur = 0, res, pex = null; const frames = rt.thread.frames, fb = frames.length, g = G, slow = fb >= rt.dlimit && H.deep(rt, fb); frames.push(g);`);
    emit(`{ const c = P.dc; P.dc = c + 1; if (c === 0) rt.t2Dirty.push(P); const ring = rt.traceRing; if (E !== null && ring != null && ring.length === 384 && rt.traceMuted !== true && rt.fastCallPaths !== false) { const i = ring.start; ring.tail[i] = E; ring.start = i === 383 ? 0 : i + 1; rt.traceDropped = (rt.traceDropped ?? 0) + 1; } else H.note(rt, P); }`);
    emit(`for (;;) { try { switch (pc) { case -1: pc = 0; if (slow) H.poll(rt);`);
  } else {
  emit('const r = f.regs, max = rt.maxInstructionsPerEvent; let pc = f.pc, n = 0, cur = 0;');
  emit('try { for (;;) switch (pc) {');
  }
  let first = true;
  for (let index = 0; index < instructions.length; index++) {
    const ins = instructions[index], { pc, op, w } = ins, a = w >> 8, lo = a & 15, hi = a >> 4, next = pc + ins.length;
    if (leaders.has(pc) || first) { emit(`case ${pc}:`); first = false; }
    if (direct && EXITS.has(op)) {
      // monitor-enter/exit and throw run here; a contended monitor leaves the instruction to the interpreter (which parks the thread). The filled-array forms go through stepRare.
      if (op === 0x1d) emit(`{ const v = ${R(a)}; if (v === null || v === 0 || v === undefined) { cur = ${pc}; n++; rt.throwJava('Ljava/lang/NullPointerException;', 'null monitor'); } if (!rt.monitorTryEnter(v, rt.thread)) { pc = ${pc}; H.deopt(rt, null); } n++; }`);
      else if (op === 0x1e) emit(`{ n++; cur = ${pc}; const v = ${R(a)}; if (v === null || v === 0 || v === undefined) rt.throwJava('Ljava/lang/NullPointerException;', 'null monitor'); rt.monitorExit(v, rt.thread); }`);
      else if (op === 0x27) emit(`n++; cur = ${pc}; H.throwValue(rt, ${R(a)});`);
      else emit(`n++; cur = ${pc}; ${op === 0x26 ? '' : 'res = '}H.rare(rt, g, ${REGS}, ${pc});`);
      continue;
    }
    if (EXITS.has(op)) { emit(`f.pc = ${pc}; return ${EXIT};`); continue; }       // handled by the interpreter loop
    if (direct && RETURNS.has(op)) {
      emit(`n++; ${FLUSH} frames.pop(); return ${op === 0x0e ? 'undefined' : op === 0x11 ? `(${R(a)} === 0 ? null : ${R(a)})` : R(a)};`);
      continue;
    }
    if (RETURNS.has(op)) {
      emit(op === 0x0e ? `n++; f.rv = undefined; return ${RET};` : op === 0x11 ? `n++; f.rv = ${R(a)} === 0 ? null : ${R(a)}; return ${RET};` : `n++; f.rv = ${R(a)}; return ${RET};`);
      continue;
    }
    if (INVOKES.has(op)) {
      // A call site whose callee the interpreter has resolved (inline cache) is entered here; anything else is left to the interpreter, which fills the cache.
      let site;
      try { site = prog.refs[pc] ??= support.makeInvokeSite(dex, u, pc, op, a, hi); } catch (error) { if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT) console.error(`JIT: ${method.key} stays interpreted: invoke site at pc ${pc} failed: ${error.message}`); return null; }
      const k = site.argc, registers = site.first >= 0 ? Array.from({ length: k }, (_, j) => site.first + j) : [u[pc + 2] & 15, (u[pc + 2] >> 4) & 15, (u[pc + 2] >> 8) & 15, (u[pc + 2] >> 12) & 15, lo].slice(0, k);
      // Pure String intrinsics, inline: a hot loop over charAt/length must not leave the compiled function (one exit through the interpreter and the bridge per call costs ~250 ns). Anything unusual (a
      // non-String receiver, an index out of range) falls through to the generic call below, which raises the real exception.
      const target = site.target, intrinsic = target ? STRING_INTRINSICS[`${target.owner}->${target.name}${target.signature}`] : undefined;
      if (intrinsic) emit(`{ const a0 = ${R(registers[0])}${registers.length > 1 ? `, a1 = ${R(registers[1])}` : ''}; if (typeof a0 === 'string') { ${intrinsic.replaceAll('${PC_NEXT}', String(pc + 3)).replaceAll('f.result', RES)} } }`);
      const index = sites.length; sites.push(site);
      const args = registers.map((x, j) => `a${j}`);
      if (direct) {
        // The direct form of a call (see the header): the site's cached DEX callee is called as a JavaScript function when it has a direct form too (frameless bodies in place, as
        // in the frame form); a call the site resolved to a host bridge is made here unless the site is known to re-enter Java (then the stack is rebuilt first, H.deopt); everything
        // else -- an unresolved site, a callee without a direct form, a static owner not yet initialized, a bridge that does not serve this receiver -- is run by the interpreter on
        // a real frame of this activation (H.slow), which also fills the site's caches.
        const virtualLookup = site.virtual ? `const rr = a0 !== null && typeof a0 === 'object' ? rt.heap.get(a0.ref) : undefined, t = rr !== undefined ? rr.type : rt.typeOf(a0); if (t !== s.type) { const pe = s.poly === null ? undefined : s.poly.get(t); if (pe === undefined) ce = null; else { ce = pe.callee; cp = pe.prog; rt.jitPolymorphic++; } }` : '';
        const ready = site.isStatic ? ' && (s.initialized || H.staticReady(rt, s, ce))' : '';
        const frameless = k <= 2 ? `if (cp.getter !== null || cp.shape !== null) { const gv = H.getterCall(rt, s, ce, cp, ${k === 0 ? 'undefined' : 'a0'}, n + 1); if (gv !== H.NO_GETTER) { n++; res = gv; break c${pc}; } } ` : '';
        emit(`c${pc}: { const s = Z[${index}]; ${registers.map((x, j) => `const a${j} = ${R(x)};`).join(' ')} cur = ${pc}; let ce = s.callee;
  if (ce !== null) { let cp = s.calleeProg; ${virtualLookup}
    if (ce !== null${ready}) { ${frameless}const d = cp.d; if (d !== null) { n++; pc = ${pc + 3}; res = d(${args.join(', ')}); break c${pc}; } } }
  if (s.bridge !== null) {
    if (s.reenters === true) { pc = ${pc}; H.deopt(rt, P); }
    n++; ${FLUSH} n = 0; const bv = H.bridge(rt, g, s, [${args.join(', ')}]);
    if (bv !== H.NO_GETTER && bv !== H.HANDOFF) { res = bv; break c${pc}; }
    rt.steps--; ST.instructions--; rt.jitInstructions--; }   // no bridge for this receiver, or an outcome the interpreter's invoke takes over (left on the ghost: H.slow hands it on)
  ${FLUSH} n = 0; pc = ${pc + 3}; res = H.slow(rt, P, g, fb, s, ${pc}, ${REGS}); }`);
        continue;
      }
      // The DEX callee the site cached (site.callee for the first receiver class, site.poly for the others, as the interpreter's polymorphic inline cache) is entered here. The callee's
      // register file is allocated and filled here (its arguments are the last k registers), so the call builds no argument array.
      const lookup = site.virtual ? `const t = H.receiverType(rt, a0); if (t !== s.type) { const pe = s.poly === null ? undefined : s.poly.get(t); if (pe === undefined) ce = null; else { ce = pe.callee; cp = pe.prog; rt.jitPolymorphic++; } }` : '';
      // A callee of up to two words may be a trivial getter, an identity, a parameter null check or a static getter: then its result is produced in place, as the interpreter's cached-call
      // path does (H.getterCall), and no frame is made.
      const getter = k <= 2 ? `if (cp.getter !== null || cp.shape !== null) { const gv = H.getterCall(rt, s, ce, cp, ${k === 0 ? 'undefined' : 'a0'}, n); if (gv !== H.NO_GETTER) { f.result = gv; pc = ${pc + 3}; continue; } } ` : '';
      // A call the site resolved to a SHIM/platform bridge is made here too (H.bridgeCall, the interpreter's bridged path): the instruction counts are published first, as the
      // interpreter's are when a host runs; an outcome the run loop must handle (frame, wait, host step) is handed over and the invoke is counted again by the interpreter, which runs it.
      const bridged = `if (s.bridge !== null) { n++; cur = ${pc}; rt.steps += n; f.prog.stats.instructions += n; rt.jitInstructions += n; n = 0; const bv = H.bridgeCall(rt, f, s, [${args.join(', ')}]);
  if (bv !== H.NO_GETTER && bv !== H.HANDOFF) { f.result = bv; pc = ${pc + 3}; continue; } rt.steps--; f.prog.stats.instructions--; rt.jitInstructions--; }`;
      emit(`{ const s = Z[${index}]; ${registers.map((x, j) => `const a${j} = ${R(x)};`).join(' ')} let ce = s.callee; if (ce !== null) { let cp = s.calleeProg; ${lookup} if (ce !== null) {
  n++; cur = ${pc}; ${getter}{ const d = cp.d; if (d !== null${site.isStatic ? ' && (s.initialized || H.staticReady(rt, s, ce))' : ''}) { f.pc = ${pc + 3}; f.callPc = ${pc}; H.enter(rt); f.result = d(${args.join(', ')}); pc = ${pc + 3}; continue; } }
  const cc = ce.code, nr = new Array(cc.registers), at = cc.registers - ${k}; ${registers.map((x, j) => `nr[at + ${j}] = a${j};`).join(' ')}
  const fb = H.prepareCall(rt, f, s, ce, cp, nr, ${pc + 3}, ${pc}); const cf = cp.fn;
  if (cf !== null && rt.jitDepth < 80) {
    rt.jitDepth++; let st; try { st = cf(fb); } finally { rt.jitDepth--; }
    if (st === ${RET}) { rt.thread.frames.pop(); f.result = fb.rv; pc = ${pc + 3}; continue; }
  }
  return ${CALL}; } }
  ${bridged}
  f.pc = ${pc}; return ${EXIT}; }`);
      continue;
    }
    const divides = (op >= 0x90 && op <= 0xcf && [3, 4, 14, 15].includes((op >= 0xb0 ? op - 0xb0 : op - 0x90))) || [0xd3, 0xd4, 0xdb, 0xdc].includes(op);
    const track = THROWING.has(op) || divides ? `cur = ${pc}; ` : '';
    const count = 'n++; ';
    const body = (() => {
      switch (op) {
        case 0x00: return '';
        case 0x01: case 0x07: return put(lo, R(hi));
        case 0x02: case 0x08: return put(a, R(u[pc + 1]));
        case 0x03: case 0x09: return put(u[pc + 1], R(u[pc + 2]));
        case 0x04: return putWide(lo, R(hi));
        case 0x05: return putWide(a, R(u[pc + 1]));
        case 0x06: return putWide(u[pc + 1], R(u[pc + 2]));
        case 0x0a: case 0x0c: return direct ? `${R(a)} = res;` : `${R(a)} = f.result; f.result = undefined;`;
        case 0x0b: return direct ? `${R(a)} = res; ${R(a + 1)} = W;` : `${R(a)} = f.result; ${R(a + 1)} = W; f.result = undefined;`;
        case 0x0d: return `${R(a)} = ${PEX}; ${PEX} = null;`;
        case 0x12: return put(lo, hi >= 8 ? hi - 16 : hi);
        case 0x13: return put(a, signed16(u[pc + 1]));
        case 0x14: return put(a, u[pc + 1] | (u[pc + 2] << 16));
        case 0x15: return put(a, u[pc + 1] << 16);
        case 0x16: return putWide(a, `${BigInt(signed16(u[pc + 1]))}n`);
        case 0x17: return putWide(a, `${BigInt(u[pc + 1] | (u[pc + 2] << 16))}n`);
        case 0x18: return putWide(a, `${BigInt.asIntN(64, BigInt(u[pc + 1]) | BigInt(u[pc + 2]) << 16n | BigInt(u[pc + 3]) << 32n | BigInt(u[pc + 4]) << 48n)}n`);
        case 0x19: return putWide(a, `${BigInt.asIntN(64, BigInt(u[pc + 1]) << 48n)}n`);
        case 0x1a: case 0x1b: { const i = op === 0x1a ? u[pc + 1] : u[pc + 1] + u[pc + 2] * 65536; dex.string(i); return `${R(a)} = S[${i}];`; }   // decoded now: S is the lazy string cache, filled for good
        case 0x1c: return `{ const t = T[${u[pc + 1]}]; if (!rt.classes.has(t)) rt.assertResolvable(t); ${R(a)} = rt.classObject(t); }`;
        case 0x1f: { const s = site({ type: null, epoch: -1, answer: false }); return `{ const v = ${R(a)}; if (v !== null && v !== 0 && !H.subtype(rt, Z[${s}], rt.typeOf(v), T[${u[pc + 1]}])) { rt.assertResolvable(T[${u[pc + 1]}]); H.castFail(rt, v, T[${u[pc + 1]}]); } }`; }
        case 0x20: { const s = site({ type: null, epoch: -1, answer: false }); return `{ const v = ${R(hi)}; ${R(lo)} = v !== null && v !== 0 && H.subtype(rt, Z[${s}], rt.typeOf(v), T[${u[pc + 1]}]) ? 1 : (rt.assertResolvable(T[${u[pc + 1]}]), 0); }`; }
        case 0x21: return `${R(lo)} = rt.vmArray(${R(hi)}).cells.length;`;
        case 0x22: { const guard = direct ? `{ const s = Z[${site({ ready: false })}]; if (!s.ready) { if (H.typeReady(rt, T[${u[pc + 1]}])) s.ready = true; else { n--; pc = ${pc}; H.deopt(rt, null); } } } ` : ''; return `${guard}rt.bytecodeAlloc = true; try { ${R(a)} = rt.allocate(T[${u[pc + 1]}]); } finally { rt.bytecodeAlloc = false; }`; }
        case 0x23: return `rt.bytecodeAlloc = true; try { ${R(lo)} = rt.newArray(T[${u[pc + 1]}], ${R(hi)} | 0); } finally { rt.bytecodeAlloc = false; }`;
        case 0x28: return jump(pc, pc + signed8(a));
        case 0x29: return jump(pc, pc + signed16(u[pc + 1]));
        case 0x2a: return jump(pc, pc + (u[pc + 1] | (u[pc + 2] << 16)));
        case 0x2b: case 0x2c: {
          const payload = pc + (u[pc + 1] | (u[pc + 2] << 16)), size = u[payload + 1], at32 = i => u[i] | (u[i + 1] << 16), cases = [];
          if (op === 0x2b) { const base = at32(payload + 2); for (let i = 0; i < size; i++) cases.push(`case ${(base + i) | 0}: ${jump(pc, pc + at32(payload + 4 + i * 2))}`); }
          else for (let i = 0; i < size; i++) cases.push(`case ${at32(payload + 2 + i * 2) | 0}: ${jump(pc, pc + at32(payload + 2 + size * 2 + i * 2))}`);
          return `switch (${R(a)} | 0) { ${cases.join(' ')} }`;
        }
        case 0x2d: case 0x2e: case 0x2f: case 0x30: case 0x31: {
          const packed = u[pc + 1], left = packed & 255, right = packed >> 8;
          const kind = op === 0x31 ? 'long' : op <= 0x2e ? 'float' : 'double', gt = op === 0x2e || op === 0x30 ? 1 : -1;
          if (kind === 'long') return `{ const x = ${R(left)}, y = ${R(right)}; ${R(a)} = x < y ? -1 : x > y ? 1 : 0; }`;
          return `${R(a)} = H.cmp('${kind}', ${gt}, ${R(left)}, ${R(right)});`;
        }
        case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37: {
          const x = R(lo), y = R(hi), t = pc + signed16(u[pc + 1]);
          const cond = op === 0x32 ? `(${x} === ${y} || H.same(${x}, ${y}))` : op === 0x33 ? `(${x} !== ${y} && !H.same(${x}, ${y}))` : op === 0x34 ? `${x} < ${y}` : op === 0x35 ? `${x} >= ${y}` : op === 0x36 ? `${x} > ${y}` : `${x} <= ${y}`;
          return `if (${cond}) { ${jump(pc, t)} }`;
        }
        case 0x38: case 0x39: case 0x3a: case 0x3b: case 0x3c: case 0x3d: {
          const x = R(a), t = pc + signed16(u[pc + 1]);
          const cond = op === 0x38 ? `(${x} === null || ${x} === 0)` : op === 0x39 ? `(${x} !== null && ${x} !== 0)` : op === 0x3a ? `${x} < 0` : op === 0x3b ? `${x} >= 0` : op === 0x3c ? `${x} > 0` : `${x} <= 0`;
          return `if (${cond}) { ${jump(pc, t)} }`;
        }
        case 0x44: case 0x45: case 0x46: case 0x47: case 0x48: case 0x49: case 0x4a: {
          const packed = u[pc + 1], variant = op - 0x44, array = R(packed & 255), index = R(packed >> 8);
          return variant === 1 ? `{ const i = ${index}; ${ARRAY('ar', array, 'i')} ${R(a)} = ar.cells[i]; ${R(a + 1)} = W; }` : `{ const i = ${index}; ${ARRAY('ar', array, 'i')} ${R(a)} = ar.cells[i]; }`;
        }
        case 0x4b: case 0x4c: case 0x4d: case 0x4e: case 0x4f: case 0x50: case 0x51: {
          const packed = u[pc + 1], variant = op - 0x4b, array = R(packed & 255), index = R(packed >> 8), v = R(a);
          const value = variant === 1 ? v : variant === 3 ? `${v} & 1` : variant === 4 ? `(${v} << 24) >> 24` : variant === 5 ? `${v} & 65535` : variant === 6 ? `(${v} << 16) >> 16` : v;
          return `{ const i = ${index}; ${ARRAY('arr', array, 'i')} const val = ${value}; ${op === 0x4d ? `rt.checkArrayValue(arr, val); ${BARRIER('arr')} ` : ''}arr.cells[i] = val; }`;   // aput-object: write barrier (heap-gc.js, "Young generation")
        }
        case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58:
        case 0x59: case 0x5a: case 0x5b: case 0x5c: case 0x5d: case 0x5e: case 0x5f: {
          const s = site({ field: null, key: null, type: null, def: undefined, more: null, slot: -1 }), store = op >= 0x59, variant = op - (store ? 0x59 : 0x52), ref = u[pc + 1]; dex.field(ref);   // FR is the lazy field-id cache: decode it now
          const prelude = `${OBJECT('o', `${R(hi)}`)} const s = Z[${s}]; if (o.type !== s.type) H.fieldSite(rt, s, FR[${ref}], o);`;
          if (!store) {
            const narrowed = variant === 3 ? 'v & 1' : variant === 4 ? '(v << 24) >> 24' : variant === 5 ? 'v & 65535' : variant === 6 ? '(v << 16) >> 16' : 'v';
            const load = 'const k = s.slot; let v = k >= 0 ? o.slots[k] : o.fields.get(s.key); if (v === undefined) v = s.def;';
            return variant === 1 ? `{ ${prelude} ${load} ${R(lo)} = v; ${R(lo + 1)} = W; }` : `{ ${prelude} ${load} ${R(lo)} = ${narrowed}; }`;
          }
          const value = variant === 3 ? `${R(lo)} & 1` : variant === 4 ? `(${R(lo)} << 24) >> 24` : variant === 5 ? `${R(lo)} & 65535` : variant === 6 ? `(${R(lo)} << 16) >> 16` : R(lo);
          // field store (write-barrier point): an already-stored slot directly, a first store through rt.storeSlot (budget), a key outside the shape through the facade
          const barrier = variant === 2 ? ` ${BARRIER('o')}` : '';   // iput-object: write barrier
          return `{ ${prelude} const k = s.slot, val = ${value}; if (k >= 0) { const sl = o.slots; if (sl[k] !== undefined) { sl[k] = val;${barrier} } else rt.storeSlot(o, k, s.key, val); } else { const m = o.fields; if (m.has(s.key)) { m.set(s.key, val);${barrier} } else rt.storeField(m, s.key, val); } }`;
        }
        case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66:
        case 0x67: case 0x68: case 0x69: case 0x6a: case 0x6b: case 0x6c: case 0x6d: {
          const s = site({ field: null, key: null, ready: false }), store = op >= 0x67, variant = op - (store ? 0x67 : 0x60), ref = u[pc + 1]; dex.field(ref);
          if (!store) {
            const narrowed = variant === 3 ? 'v & 1' : variant === 4 ? '(v << 24) >> 24' : variant === 5 ? 'v & 65535' : variant === 6 ? '(v << 16) >> 16' : 'v';
            const read = `const s = Z[${s}]; ${direct ? `if (!s.ready && !H.fieldReady(rt, FR[${ref}])) { n--; pc = ${pc}; H.deopt(rt, null); } ` : ''}let v; if (s.ready) { v = rt.staticFields.get(s.key); if (v === undefined) v = rt.readStatic(FR[${ref}]); } else v = H.staticSite(rt, s, FR[${ref}]);`;
            return variant === 1 ? `{ ${read} ${R(a)} = v; ${R(a + 1)} = W; }` : `{ ${read} ${R(a)} = ${narrowed}; }`;
          }
          const value = variant === 3 ? `${R(a)} & 1` : variant === 4 ? `(${R(a)} << 24) >> 24` : variant === 5 ? `${R(a)} & 65535` : variant === 6 ? `(${R(a)} << 16) >> 16` : R(a);
          return `{ const s = Z[${s}]; ${direct ? `if (!s.ready && !H.fieldReady(rt, FR[${ref}])) { n--; pc = ${pc}; H.deopt(rt, null); } ` : ''}if (s.ready && rt.staticFields.has(s.key)) rt.staticFields.set(s.key, ${value}); else { rt.writeStatic(FR[${ref}], ${value}); H.staticSite(rt, s, FR[${ref}], true); } }`;
        }
        case 0x7b: return put(lo, `(-${R(hi)}) | 0`);
        case 0x7c: return put(lo, `~${R(hi)}`);
        case 0x7d: return putWide(lo, `BigInt.asIntN(64, -${R(hi)})`);
        case 0x7e: return putWide(lo, `~${R(hi)}`);
        case 0x7f: return put(lo, `H.floatBits(-H.floatNumber(${R(hi)}))`);
        case 0x80: return putWide(lo, `H.doubleBits(-H.doubleNumber(${R(hi)}))`);
        case 0x81: return putWide(lo, `BigInt(${R(hi)})`);
        case 0x82: return put(lo, `H.floatBits(${R(hi)})`);
        case 0x83: return putWide(lo, `H.doubleBits(${R(hi)})`);
        case 0x84: return put(lo, `Number(BigInt.asIntN(32, ${R(hi)}))`);
        case 0x85: return put(lo, `H.floatBits(Number(${R(hi)}))`);
        case 0x86: return putWide(lo, `H.doubleBits(Number(${R(hi)}))`);
        case 0x87: return put(lo, `H.javaInt(H.floatNumber(${R(hi)}))`);
        case 0x88: return putWide(lo, `H.javaLong(H.floatNumber(${R(hi)}))`);
        case 0x89: return putWide(lo, `H.doubleBits(H.floatNumber(${R(hi)}))`);
        case 0x8a: return put(lo, `H.javaInt(H.doubleNumber(${R(hi)}))`);
        case 0x8b: return putWide(lo, `H.javaLong(H.doubleNumber(${R(hi)}))`);
        case 0x8c: return put(lo, `H.floatBits(H.doubleNumber(${R(hi)}))`);
        case 0x8d: return put(lo, `(${R(hi)} << 24) >> 24`);
        case 0x8e: return put(lo, `${R(hi)} & 65535`);
        case 0x8f: return put(lo, `(${R(hi)} << 16) >> 16`);
        default: {
          if (op >= 0x90 && op <= 0xcf) {
            const two = op >= 0xb0, relative = op - (two ? 0xb0 : 0x90);
            const group = relative < 11 ? 0 : relative < 22 ? 1 : relative < 27 ? 2 : 3;
            const operation = relative - (group === 0 ? 0 : group === 1 ? 11 : group === 2 ? 22 : 27);
            const packed = two ? 0 : u[pc + 1], destination = two ? lo : a, left = two ? lo : packed & 255, right = two ? hi : packed >> 8;
            const x = R(left), y = R(right);
            if (group === 0) { const e = intBinary(operation, x, y, false); return put(destination, e); }
            if (group === 1) { const shift = operation >= 8, inline = longBinary(operation, x, shift ? `(${y} | 0)` : y); return putWide(destination, inline ?? `H.long(${operation}, ${x}, ${shift ? `${y} | 0` : y})`); }
            if (operation <= 3) {   // float/double add, sub, mul, div inline (rem through numericBinary): the operation on the numbers, rounded by the bits conversion as numericBinary does
              const sign = ['+', '-', '*', '/'][operation];
              return group === 2 ? put(destination, `H.floatBits(H.floatNumber(${x}) ${sign} H.floatNumber(${y}))`) : putWide(destination, `H.doubleBits(H.doubleNumber(${x}) ${sign} H.doubleNumber(${y}))`);
            }
            const kind = group === 2 ? 'float' : 'double';
            return group === 2 ? put(destination, `H.num('float', ${operation}, ${x}, ${y})`) : putWide(destination, `H.num('double', ${operation}, ${x}, ${y})`);
          }
          if (op >= 0xd0 && op <= 0xd7) {
            const operation = op - 0xd0, lit = signed16(u[pc + 1]), e = intBinary(operation, R(hi), String(lit), operation === 1);
            return e === null ? null : put(lo, e);
          }
          if (op >= 0xd8 && op <= 0xe2) {
            const packed = u[pc + 1], operation = op - 0xd8, lit = signed8(packed >> 8), e = intBinary(operation, R(packed & 255), String(lit), operation === 1);
            return e === null ? null : put(a, e);
          }
          return null;
        }
      }
    })();
    if (body === null) { if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT) console.error(`JIT: ${method.key} stays interpreted: opcode 0x${op.toString(16)} at pc ${pc} is not compiled`); return null; }
    emit(`${count}${track}${body}`);
    // fall through into the next case label; a block that ends in an unconditional jump never falls through
  }
  if (direct) emit(`default: throw new Error('direct code entered at an instruction that is not a block leader: ' + pc); } }
  catch (e) { ${FLUSH} n = 0; if (e === H.DEOPT) { H.materialize(rt, P, g, fb, pc, cur, ${REGS}, res, pex); throw e; } pc = H.caught(rt, e, P, g, fb, cur, ${REGS}); pex = g.pendingException; g.pendingException = null; } }`);
  else emit(`default: f.pc = pc; return ${EXIT}; } } catch (e) { f.cur = cur; throw e; } finally { rt.steps += n; f.prog.stats.instructions += n; rt.jitInstructions += n; }`);
  const named = globalThis.process?.env?.APKWEB_DEBUG_JIT_NAMES ? `_${String(method.key).replace(/[^A-Za-z0-9]+/g, '_').slice(-70)}` : '';   // profiles: one row per method instead of one for all
  const source = direct ? `"use strict"; return function direct${named}(${Array.from({ length: code.incoming }, (_, i) => `p${i}`).join(', ')}) {\n${lines.join('\n')}\n};`
    : `"use strict"; return function compiled(f) {\n${lines.join('\n')}\n};`;
  try {
    const factory = new Function('rt', 'H', 'S', 'T', 'FR', 'Z', 'W', 'P', 'G', 'ST', 'E', source);
    if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT_DUMP && method.key.includes(process.env.APKWEB_DEBUG_JIT_DUMP)) console.error('JIT', method.key, '\n' + source);
    return factory(rt, support.helpers, dex.strings, dex.types, dex.fields, sites, support.WIDE_HIGH, prog, direct ? prog.ghost : null, prog.stats, direct ? support.helpers.entryOf(prog) : null);   // S/T/FR: the DexFile caches themselves (every index this code uses was decoded above)
  } catch (error) {
    if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT) console.error('JIT compile failed for', method.key, error.message, '\n', source.slice(0, 2000));
    return null;
  }
}
