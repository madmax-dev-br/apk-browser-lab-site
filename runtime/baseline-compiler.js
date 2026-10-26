// Baseline compiler: turns a hot DEX method into a JavaScript function that executes the same instructions over the same frame (Frame.regs / pc / result), so the interpreter
// loop and compiled code can hand a frame back and forth at any instruction boundary.
//
// What is compiled: everything that cannot call or leave the frame -- moves, constants, arithmetic, comparisons, branches and switches, array and field access, allocation,
// casts. What is left to the interpreter loop: invoke*, return*, throw, monitor-enter/exit, filled-new-array, fill-array-data. The compiled function runs until it reaches one of
// those instructions (it stores that pc in frame.pc and returns EXIT), or reaches a backward branch when the thread's instruction quantum is used up (YIELD, so another thread
// can run). The interpreter then executes the one instruction and re-enters the compiled code at the next pc. Because invokes and returns stay in the interpreter, frames are
// pushed and popped in exactly one place and a compiled method can block, be preempted, throw and unwind like an interpreted one.
//
// Exactness: instruction counts (rt.steps, executionByOrigin) are maintained per instruction; a throwing instruction records its pc (frame.cur) so exception tables apply as in
// the interpreter. Operand checks the interpreter performs on every access (register initialised, int/wide type) are not repeated here: they guard against a malformed DEX or an
// interpreter bug, not against Java semantics, and the verifier-clean code of an APK cannot trigger them.

export const EXIT = 1, YIELD = 2, CALL = 3, RET = 4;
export const MAX_COMPILED_UNITS = 6000;

const UNITS = new Uint8Array(256).fill(0);
for (const op of [0x00, 0x01, 0x04, 0x07, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x1d, 0x1e, 0x21, 0x27, 0x28]) UNITS[op] = 1;
for (let op = 0x7b; op <= 0x8f; op++) UNITS[op] = 1;
for (let op = 0xb0; op <= 0xcf; op++) UNITS[op] = 1;
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

export function compileMethod(rt, method, code, prog, tries, support) {
  const { units, dex } = prog, u = units;
  const handlerTargets = []; for (const entry of tries) { for (const h of entry.catches) handlerTargets.push(h.address); if (entry.catchAll !== null) handlerTargets.push(entry.catchAll); }
  const decoded = scan(u, code.units, handlerTargets); if (decoded === null) return null;
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
  const R = n => `r[${n}]`;
  const W = 'W';
  const put = (n, e) => `r[${n}] = ${e};`;
  const putWide = (n, e) => `r[${n}] = ${e}; r[${n + 1}] = W;`;
  const jump = (from, target) => {
    if (target <= from) return `if (rt.steps + n > max) { n -= rt.steps + n - max - 1; H.fuse(max); } if (--rt.q <= 0) { rt.q = ${support.QUANTUM}; f.pc = ${target}; return ${YIELD}; } pc = ${target}; continue;`;
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

  emit('const r = f.regs, max = rt.maxInstructionsPerEvent; let pc = f.pc, n = 0, cur = 0;');
  emit('try { for (;;) switch (pc) {');
  let first = true;
  for (let index = 0; index < instructions.length; index++) {
    const ins = instructions[index], { pc, op, w } = ins, a = w >> 8, lo = a & 15, hi = a >> 4, next = pc + ins.length;
    if (leaders.has(pc) || first) { emit(`case ${pc}:`); first = false; }
    if (EXITS.has(op)) { emit(`f.pc = ${pc}; return ${EXIT};`); continue; }       // handled by the interpreter loop
    if (RETURNS.has(op)) {
      emit(op === 0x0e ? `n++; f.rv = undefined; return ${RET};` : op === 0x11 ? `n++; f.rv = r[${a}] === 0 ? null : r[${a}]; return ${RET};` : `n++; f.rv = r[${a}]; return ${RET};`);
      continue;
    }
    if (INVOKES.has(op)) {
      // A call site whose callee the interpreter has resolved (inline cache) is entered here; anything else is left to the interpreter, which fills the cache.
      let site;
      try { site = prog.refs[pc] ??= support.makeInvokeSite(dex, u, pc, op, a, hi); } catch { return null; }
      const k = site.argc, registers = site.first >= 0 ? Array.from({ length: k }, (_, j) => site.first + j) : [u[pc + 2] & 15, (u[pc + 2] >> 4) & 15, (u[pc + 2] >> 8) & 15, (u[pc + 2] >> 12) & 15, lo].slice(0, k);
      const index = sites.length; sites.push(site);
      const hit = site.virtual ? `H.receiverType(rt, a0) === s.type` : 'true';
      emit(`{ const s = Z[${index}]; if (s.callee !== null) { ${registers.map((x, j) => `const a${j} = r[${x}];`).join(' ')} if (${hit}) {
  n++; cur = ${pc}; const fb = H.prepareCall(rt, f, s, [${registers.map((x, j) => `a${j}`).join(', ')}], ${pc + 3}, ${pc}); const cf = fb.prog.fn;
  if (cf !== null && rt.jitDepth < 80) {
    rt.jitDepth++; let st; try { st = cf(fb); } finally { rt.jitDepth--; }
    if (st === ${RET}) { rt.thread.frames.pop(); f.result = fb.rv; pc = ${pc + 3}; continue; }
  }
  return ${CALL}; } } f.pc = ${pc}; return ${EXIT}; }`);
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
        case 0x0a: case 0x0c: return `r[${a}] = f.result; f.result = undefined;`;
        case 0x0b: return `r[${a}] = f.result; r[${a + 1}] = W; f.result = undefined;`;
        case 0x0d: return `r[${a}] = f.pendingException; f.pendingException = null;`;
        case 0x12: return put(lo, hi >= 8 ? hi - 16 : hi);
        case 0x13: return put(a, signed16(u[pc + 1]));
        case 0x14: return put(a, u[pc + 1] | (u[pc + 2] << 16));
        case 0x15: return put(a, u[pc + 1] << 16);
        case 0x16: return putWide(a, `${BigInt(signed16(u[pc + 1]))}n`);
        case 0x17: return putWide(a, `${BigInt(u[pc + 1] | (u[pc + 2] << 16))}n`);
        case 0x18: return putWide(a, `${BigInt.asIntN(64, BigInt(u[pc + 1]) | BigInt(u[pc + 2]) << 16n | BigInt(u[pc + 3]) << 32n | BigInt(u[pc + 4]) << 48n)}n`);
        case 0x19: return putWide(a, `${BigInt.asIntN(64, BigInt(u[pc + 1]) << 48n)}n`);
        case 0x1a: case 0x1b: { const i = op === 0x1a ? u[pc + 1] : u[pc + 1] + u[pc + 2] * 65536; return `r[${a}] = S[${i}];`; }
        case 0x1c: return `r[${a}] = rt.classObject(T[${u[pc + 1]}]);`;
        case 0x1f: return `{ const v = r[${a}]; if (v !== null && v !== 0 && !rt.isSubtype(rt.typeOf(v), T[${u[pc + 1]}])) H.castFail(rt, v, T[${u[pc + 1]}]); }`;
        case 0x20: return `{ const v = r[${hi}]; r[${lo}] = v !== null && v !== 0 && rt.isSubtype(rt.typeOf(v), T[${u[pc + 1]}]) ? 1 : 0; }`;
        case 0x21: return `r[${lo}] = rt.array(r[${hi}]).elements.length;`;
        case 0x22: return `r[${a}] = rt.allocate(T[${u[pc + 1]}]);`;
        case 0x23: return `r[${lo}] = rt.newArray(T[${u[pc + 1]}], r[${hi}] | 0);`;
        case 0x28: return jump(pc, pc + signed8(a));
        case 0x29: return jump(pc, pc + signed16(u[pc + 1]));
        case 0x2a: return jump(pc, pc + (u[pc + 1] | (u[pc + 2] << 16)));
        case 0x2b: case 0x2c: {
          const payload = pc + (u[pc + 1] | (u[pc + 2] << 16)), size = u[payload + 1], at32 = i => u[i] | (u[i + 1] << 16), cases = [];
          if (op === 0x2b) { const base = at32(payload + 2); for (let i = 0; i < size; i++) cases.push(`case ${(base + i) | 0}: ${jump(pc, pc + at32(payload + 4 + i * 2))}`); }
          else for (let i = 0; i < size; i++) cases.push(`case ${at32(payload + 2 + i * 2) | 0}: ${jump(pc, pc + at32(payload + 2 + size * 2 + i * 2))}`);
          return `switch (r[${a}] | 0) { ${cases.join(' ')} }`;
        }
        case 0x2d: case 0x2e: case 0x2f: case 0x30: case 0x31: {
          const packed = u[pc + 1], left = packed & 255, right = packed >> 8;
          const kind = op === 0x31 ? 'long' : op <= 0x2e ? 'float' : 'double', gt = op === 0x2e || op === 0x30 ? 1 : -1;
          return `r[${a}] = H.cmp('${kind}', ${gt}, r[${left}], r[${right}]);`;
        }
        case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37: {
          const x = R(lo), y = R(hi), t = pc + signed16(u[pc + 1]);
          const cond = op === 0x32 ? `H.same(${x}, ${y})` : op === 0x33 ? `!H.same(${x}, ${y})` : op === 0x34 ? `${x} < ${y}` : op === 0x35 ? `${x} >= ${y}` : op === 0x36 ? `${x} > ${y}` : `${x} <= ${y}`;
          return `if (${cond}) { ${jump(pc, t)} }`;
        }
        case 0x38: case 0x39: case 0x3a: case 0x3b: case 0x3c: case 0x3d: {
          const x = R(a), t = pc + signed16(u[pc + 1]);
          const cond = op === 0x38 ? `(${x} === null || ${x} === 0)` : op === 0x39 ? `(${x} !== null && ${x} !== 0)` : op === 0x3a ? `${x} < 0` : op === 0x3b ? `${x} >= 0` : op === 0x3c ? `${x} > 0` : `${x} <= 0`;
          return `if (${cond}) { ${jump(pc, t)} }`;
        }
        case 0x44: case 0x45: case 0x46: case 0x47: case 0x48: case 0x49: case 0x4a: {
          const packed = u[pc + 1], variant = op - 0x44, array = R(packed & 255), index = R(packed >> 8);
          return variant === 1 ? `{ const e = rt.array(${array}, ${index}).elements[${index}]; r[${a}] = e; r[${a + 1}] = W; }` : `r[${a}] = rt.array(${array}, ${index}).elements[${index}];`;
        }
        case 0x4b: case 0x4c: case 0x4d: case 0x4e: case 0x4f: case 0x50: case 0x51: {
          const packed = u[pc + 1], variant = op - 0x4b, array = R(packed & 255), index = R(packed >> 8), v = R(a);
          const value = variant === 1 ? v : variant === 3 ? `${v} & 1` : variant === 4 ? `(${v} << 24) >> 24` : variant === 5 ? `${v} & 65535` : variant === 6 ? `(${v} << 16) >> 16` : v;
          return `{ const arr = rt.array(${array}, ${index}); const val = ${value}; ${op === 0x4d ? 'rt.checkArrayValue(arr, val); ' : ''}arr.elements[${index}] = val; }`;
        }
        case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58:
        case 0x59: case 0x5a: case 0x5b: case 0x5c: case 0x5d: case 0x5e: case 0x5f: {
          const s = site({ field: null, key: null, type: null, def: undefined }), store = op >= 0x59, variant = op - (store ? 0x59 : 0x52), ref = u[pc + 1];
          const prelude = `const o = rt.object(r[${hi}]); const s = Z[${s}]; if (o.type !== s.type) H.fieldSite(rt, s, FR[${ref}], o);`;
          if (!store) {
            const narrowed = variant === 3 ? 'v & 1' : variant === 4 ? '(v << 24) >> 24' : variant === 5 ? 'v & 65535' : variant === 6 ? '(v << 16) >> 16' : 'v';
            return variant === 1 ? `{ ${prelude} let v = o.fields.get(s.key); if (v === undefined) v = s.def; r[${lo}] = v; r[${lo + 1}] = W; }` : `{ ${prelude} let v = o.fields.get(s.key); if (v === undefined) v = s.def; r[${lo}] = ${narrowed}; }`;
          }
          const value = variant === 3 ? `${R(lo)} & 1` : variant === 4 ? `(${R(lo)} << 24) >> 24` : variant === 5 ? `${R(lo)} & 65535` : variant === 6 ? `(${R(lo)} << 16) >> 16` : R(lo);
          return `{ ${prelude} const m = o.fields; if (m.has(s.key)) m.set(s.key, ${value}); else rt.storeField(m, s.key, ${value}); }`;
        }
        case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66:
        case 0x67: case 0x68: case 0x69: case 0x6a: case 0x6b: case 0x6c: case 0x6d: {
          const s = site({ field: null, key: null, ready: false }), store = op >= 0x67, variant = op - (store ? 0x67 : 0x60), ref = u[pc + 1];
          if (!store) {
            const narrowed = variant === 3 ? 'v & 1' : variant === 4 ? '(v << 24) >> 24' : variant === 5 ? 'v & 65535' : variant === 6 ? '(v << 16) >> 16' : 'v';
            const read = `const s = Z[${s}]; let v; if (s.ready) { v = rt.staticFields.get(s.key); if (v === undefined) v = rt.readStatic(FR[${ref}]); } else v = H.staticSite(rt, s, FR[${ref}]);`;
            return variant === 1 ? `{ ${read} r[${a}] = v; r[${a + 1}] = W; }` : `{ ${read} r[${a}] = ${narrowed}; }`;
          }
          const value = variant === 3 ? `${R(a)} & 1` : variant === 4 ? `(${R(a)} << 24) >> 24` : variant === 5 ? `${R(a)} & 65535` : variant === 6 ? `(${R(a)} << 16) >> 16` : R(a);
          return `{ const s = Z[${s}]; if (s.ready && rt.staticFields.has(s.key)) rt.staticFields.set(s.key, ${value}); else { rt.writeStatic(FR[${ref}], ${value}); H.staticSite(rt, s, FR[${ref}], true); } }`;
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
            if (group === 1) { const shift = operation >= 8; return putWide(destination, `H.long(${operation}, ${x}, ${shift ? `${y} | 0` : y})`); }
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
    if (body === null) return null;
    emit(`${count}${track}${body}`);
    // fall through into the next case label; a block that ends in an unconditional jump never falls through
  }
  emit(`default: f.pc = pc; return ${EXIT}; } } catch (e) { f.cur = cur; throw e; } finally { rt.steps += n; f.prog.stats.instructions += n; rt.jitInstructions += n; }`);
  const source = `"use strict"; return function compiled(f) {\n${lines.join('\n')}\n};`;
  try {
    const factory = new Function('rt', 'H', 'S', 'T', 'FR', 'Z', 'W', source);
    if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT_DUMP && method.key.includes(process.env.APKWEB_DEBUG_JIT_DUMP)) console.error('JIT', method.key, '\n' + source);
    return factory(rt, support.helpers, dex.strings, dex.types, dex.fields, sites, support.WIDE_HIGH);
  } catch (error) {
    if (typeof process !== 'undefined' && process.env?.APKWEB_DEBUG_JIT) console.error('JIT compile failed for', method.key, error.message, '\n', source.slice(0, 2000));
    return null;
  }
}
