// The back end of the lab's GLSL ES compiler (docs/OPENGL-ES-ON-CPU.md): a checked shader (src/cpu-gl/glsl-check.js) becomes one JavaScript function per stage, compiled with
// new Function as the Dalvik baseline compiler does (src/baseline-compiler.js). Every value is scalarised (a vec4 is four JS numbers in four locals; matrices column-major),
// every user function is inlined at its calls (GLSL ES forbids recursion), arrays and structs with arrays live in Float64Arrays. Uniforms are read from the program's store U,
// uniform blocks from a store per block, attributes from A, the stage's outputs are written to O and a fragment's inputs read from I.
//
// Derivatives: a fragment shader that calls dFdx / dFdy / fwidth or samples a mipmapped texture with an implicit level needs the value of an expression at the next pixel in x
// and in y. The values on which such an expression depends and that vary across pixels get two extra "lanes" (the same computation at x+1 and at y+1, fed by the interpolated
// inputs there); control flow follows the pixel's own lane, as derivatives are only defined in uniform control flow (GLSL ES 3.00 8.9). No process.*.
import { GlslError } from './glsl-parse.js?v=7233a7b1ab13';
import { FLOAT, INT, UINT, BOOL, vec, mat, comps, needsStore, containsSampler, fieldOffset, isInteger } from './glsl-types.js?v=7233a7b1ab13';
import { IMPLICIT_LOD, coerce } from './glsl-check.js?v=7233a7b1ab13';

const fail = (message, line) => { throw new GlslError(message, line); };
const SIMPLE = /^(?:[A-Za-z_$][\w$]*|\(?-?(?:\d+(?:\.\d*)?(?:e[-+]?\d+)?|Infinity)\)?|NaN|[A-Za-z_$][\w$]*\[[^\[\]]+\])$/;
const TEMP = /^(?:t\d+|\(?-?\d+(?:\.\d*)?(?:e[-+]?\d+)?\)?|NaN|\(?-?Infinity\)?)$/;
export const LOOP_LIMIT = 1 << 22;
/** A JS literal of a number (negative ones parenthesised). */
export function lit(v) { if (Number.isNaN(v)) return 'NaN'; if (v === Infinity) return 'Infinity'; if (v === -Infinity) return '(-Infinity)'; if (Object.is(v, -0)) return '(-0)'; return v < 0 ? `(${v})` : String(v); }

// sampler call modes (src/cpu-gl/textures.js reads them)
export const MODE = { LOD: 1, GRAD: 2, BIAS: 4, OFFSET: 8, COMPARE: 16, FETCH: 32 };

/**
 * Generates a stage. `layout` (from the program's link, src/cpu-gl/program.js):
 *   uniform(sym) -> { store, base } for a uniform (or block) symbol; attribute(sym) -> location; varying(sym) -> offset in O (vertex) / I (fragment); output(sym) -> offset in O.
 * Returns { source, factory(rt) -> main, usedUniforms: Set(sym), laneInputs: Set(offsets of I that need neighbour values), usesFragCoordLanes, usesDiscard }.
 */
export function generate(shader, layout) {
  const g = new Gen(shader, layout);
  const source = g.program();
  let factory;
  try { factory = new Function('rt', source); }
  catch (error) { throw new Error(`internal: generated shader does not parse (${error.message})\n${source}`); }
  return { source, factory, usedUniforms: g.usedUniforms, usedSymbols: g.usedSymbols, laneInputs: g.laneInputs, fragCoordLanes: g.fragCoordLanes, pointCoordLanes: g.pointCoordLanes, needsLanes: g.needsLanes };
}

// ---- the lane analysis --------------------------------------------------------------------------------------------------------------------------------------------------------
/** Symbols whose values need the x+1 / y+1 lanes: they flow into a derivative and depend on a fragment input (see the header). */
function analyzeLanes(shader) {
  const edges = new Map();   // target sym -> Set(source syms)
  const add = (target, sources) => { if (!target) return; let set = edges.get(target); if (!set) edges.set(target, set = new Set()); for (const s of sources) set.add(s); };
  const sites = [];
  const root = e => e.kind === 'Ident' ? e.sym : e.kind === 'Field' || e.kind === 'Index' ? root(e.e) : null;
  const refs = e => {
    if (!e) return new Set();
    switch (e.kind) {
      case 'Num': case 'Length': return new Set();
      case 'Ident': return new Set([e.sym]);
      case 'Binary': return union(refs(e.l), refs(e.r));
      case 'Unary': return refs(e.e);
      case 'Comma': refs(e.l); return refs(e.r);
      case 'Ternary': refs(e.c); return union(refs(e.a), refs(e.b));
      case 'Field': return refs(e.e);
      case 'Index': return union(refs(e.e), refs(e.index));
      case 'Assign': { const r = refs(e.r), target = root(e.l); refs(e.l); add(target, e.op === '=' ? r : union(r, new Set([target]))); return new Set([target]); }
      case 'Prefix': case 'Postfix': { const target = root(e.e); refs(e.e); return new Set([target]); }
      case 'Call': {
        const argRefs = e.args.map(refs);
        if (e.fn) { e.fn.params.forEach((p, i) => { if (!p.sym) return; if (p.qual !== 'out') add(p.sym, argRefs[i]); if (p.qual !== 'in') add(root(e.args[i]), new Set([p.sym])); }); return new Set([e.fn.retSym]); }
        if (e.builtin) {
          const name = e.builtin.name;
          if (['dFdx', 'dFdy', 'fwidth'].includes(name)) sites.push(argRefs[0]);
          else if (IMPLICIT_LOD.has(name)) sites.push(argRefs[1]);
          e.builtin.outs.forEach((out, i) => { if (out) add(root(e.args[i]), argRefs[0]); });
          if (name.startsWith('texture') || name.startsWith('texel')) return argRefs.slice(1).reduce(union, new Set());
        }
        return argRefs.reduce(union, new Set());
      }
      default: return new Set();
    }
  };
  const stmt = (s, fn) => {
    if (!s) return;
    switch (s.kind) {
      case 'Compound': for (const x of s.stmts) stmt(x, fn); return;
      case 'Expr': refs(s.e); return;
      case 'DeclStmt': if (s.decl.kind === 'VarDecl') for (const v of s.decl.vars) if (v.init) add(v.sym, refs(v.init)); return;
      case 'If': refs(s.c); stmt(s.a, fn); stmt(s.b, fn); return;
      case 'While': if (s.c.kind === 'CondDecl') add(s.c.sym, refs(s.c.init)); else refs(s.c); stmt(s.body, fn); return;
      case 'DoWhile': stmt(s.body, fn); refs(s.c); return;
      case 'For': if (s.init) stmt(s.init.kind === 'VarDecl' ? { kind: 'DeclStmt', decl: s.init } : s.init, fn); if (s.c) { if (s.c.kind === 'CondDecl') add(s.c.sym, refs(s.c.init)); else refs(s.c); } refs(s.inc); stmt(s.body, fn); return;
      case 'Switch': refs(s.e); for (const x of s.body.stmts) stmt(x, fn); return;
      case 'Return': if (s.e) add(fn.retSym, refs(s.e)); return;
    }
  };
  for (const fn of shader.functions) for (const s of fn.body.stmts) stmt(s, fn);
  for (const sym of shader.globals) if (sym.init) add(sym, refs(sym.init));
  // need: backward from the sites; dep: forward from the varying inputs
  const need = new Set(), work = [];
  for (const site of sites) for (const s of site) if (s && !need.has(s)) { need.add(s); work.push(s); }
  while (work.length) { const s = work.pop(); for (const source of edges.get(s) ?? []) if (source && !need.has(source)) { need.add(source); work.push(source); } }
  const forward = new Map(); for (const [target, sources] of edges) for (const source of sources) { if (!forward.has(source)) forward.set(source, new Set()); forward.get(source).add(target); }
  const dep = new Set(), queue = [];
  for (const s of shader.inputs) { dep.add(s); queue.push(s); }
  for (const g of shader.ast.decls) void g;
  const builtinInputs = [];
  for (const fn of shader.functions) void fn;
  const scan = s => { if (s && (s.builtin === 'gl_FragCoord' || s.builtin === 'gl_PointCoord') && !dep.has(s)) { dep.add(s); queue.push(s); builtinInputs.push(s); } };
  for (const [target, sources] of edges) { scan(target); for (const s of sources) scan(s); }
  for (const site of sites) for (const s of site) scan(s);
  while (queue.length) { const s = queue.pop(); for (const t of forward.get(s) ?? []) if (t && !dep.has(t)) { dep.add(t); queue.push(t); } }
  const lanes = new Set(); for (const s of need) if (dep.has(s)) lanes.add(s);
  return { lanes, hasSites: sites.length > 0 };
}
const union = (a, b) => { const out = new Set(a); for (const x of b) out.add(x); return out; };

// ---- the generator ------------------------------------------------------------------------------------------------------------------------------------------------------------
class Gen {
  constructor(shader, layout) {
    this.shader = shader; this.layout = layout; this.stage = shader.stage; this.out = []; this.n = 0; this.hoisted = []; this.stores = []; this.globalsMap = new Map(); this.env = [];
    this.usedUniforms = new Set(); this.usedSymbols = new Set(); this.laneInputs = new Set(); this.fragCoordLanes = false; this.pointCoordLanes = false;
    this.labels = 0; this.targets = []; this.fnStack = [];
    const analysis = this.stage === 'fragment' ? analyzeLanes(shader) : { lanes: new Set(), hasSites: false };
    this.lanes = analysis.lanes; this.needsLanes = analysis.hasSites;
  }
  emit(line) { this.out.push(line); }
  tmp() { return `t${++this.n}`; }
  local(prefix = 'v') { const name = `${prefix}${++this.n}`; this.hoisted.push(name); return name; }
  label(prefix) { return `${prefix}${++this.labels}`; }
  store(size) { const name = `s${++this.n}`; this.stores.push(`const ${name}=new Float64Array(${Math.max(1, size)});`); return name; }
  /** Binds a temp to an expression; returns its name. */
  let(expr) { if (TEMP.test(expr)) return expr; const t = this.tmp(); this.emit(`let ${t}=${expr};`); return t; }
  simple(expr) { return SIMPLE.test(expr) ? expr : this.let(expr); }

  // values: { t, c: [lane-0 components], l: [lane1 components, lane2 components] | null } or { t, st: { name, base, lanes: [name1, name2] | null } } for store types
  val(t, c, l = null) { return { t, c, l }; }
  lane(v, k) { return k === 0 || !v.l ? v.c : v.l[k - 1]; }
  /** Component-wise: fn(...components) per component of the result type and per lane present (scalars broadcast). */
  cw(t, args, fn, wantLanes = true) {
    const n = comps(t), laned = wantLanes && args.some(a => a.l);
    const one = k => Array.from({ length: n }, (_, i) => this.let(fn(...args.map(a => { const cs = this.lane(a, k); return cs.length === 1 ? cs[0] : cs[i]; }), i)));
    return this.val(t, one(0), laned ? [one(1), one(2)] : null);
  }
  /** A per-lane computation that returns whole component lists: fn(laneComponents[], k) -> [component exprs]. */
  lanewise(t, args, fn, wantLanes = true) {
    const laned = wantLanes && args.some(a => a.l);
    const one = k => fn(args.map(a => this.lane(a, k)), k).map(x => this.let(x));
    return this.val(t, one(0), laned ? [one(1), one(2)] : null);
  }

  program() {
    const shader = this.shader;
    // globals: the stage's interface, uniforms and the shader's own globals
    for (const sym of shader.globals) this.bindGlobal(sym);
    this.fnBody(shader.main);
    const body = this.out.join('\n');
    const head = [
      'const U=rt.U,A=rt.A,O=rt.O,I=rt.I,L1=rt.L1,L2=rt.L2,F=rt.F,F1=rt.F1,F2=rt.F2,P=rt.P,R=rt.R,S2=rt.S2,S3=rt.S3,SC=rt.SC,SA=rt.SA,B=rt.B;',
      ...this.blockStores.map(([name, i]) => `const ${name}=B[${i}];`),
      ...this.stores,
    ];
    const hoisted = this.hoisted.length ? `let ${this.hoisted.map(h => `${h}=0`).join(',')};` : '';
    return `${head.join('\n')}\nreturn function main(){\n${hoisted}\n${this.prologue.join('\n')}\nMAIN:{\n${body}\n}\nreturn 0;\n};`;
  }
  get blockStores() { return this._blockStores ??= []; }
  get prologue() { return this._prologue ??= []; }
  bindGlobal(sym) {
    const layout = this.layout;
    if (sym.storage === 'uniform') return;   // bound when first used (bindingOf)
    if (sym.storage === 'in' && this.stage === 'vertex') return;
    if (sym.storage === 'in' || sym.storage === 'out') return;
    void layout;
  }
  /** The binding of a symbol now: { vars: names, l } | { st: { name, base, lanes } }. */
  bindingOf(sym, line) {
    for (let i = this.env.length - 1; i >= 0; i--) { const b = this.env[i].get(sym); if (b) return b; }
    const known = this.globalsMap.get(sym); if (known) return known;
    this.usedSymbols.add(sym);
    let b;
    if (sym.builtin) b = this.builtinBinding(sym, line);
    else if (sym.storage === 'uniform') {
      this.usedUniforms.add(sym);
      const at = this.layout.uniform(sym);
      if (at.store !== 'U') { if (!this.blockStores.some(([n]) => n === at.store)) this.blockStores.push([at.store, at.index]); }
      b = { st: { name: at.store, base: String(at.base), lanes: null }, readonly: true };
    } else if (sym.storage === 'in' && this.stage === 'vertex') {
      const loc = this.layout.attribute(sym), t = sym.type, names = [];
      const columns = t.k === 'matrix' ? t.c : 1, rows = t.k === 'matrix' ? t.r : comps(t);
      for (let c = 0; c < columns; c++) for (let r = 0; r < rows; r++) { const name = this.local('a'); names.push(name); this.prologue.push(`${name}=A[${(loc + c) * 4 + r}];`); }
      b = { vars: names, l: null };
    } else if (sym.storage === 'in') {
      const base = this.layout.varying(sym), laned = this.lanes.has(sym);
      if (laned) for (let k = 0; k < comps(sym.type); k++) this.laneInputs.add(base + k);
      b = { st: { name: 'I', base: String(base), lanes: laned ? ['L1', 'L2'] : null }, readonly: true };
    } else if (sym.storage === 'out') {
      b = { st: { name: 'O', base: String(this.stage === 'vertex' ? this.layout.varying(sym) : this.layout.output(sym)), lanes: null } };
    } else if (sym.storage === 'const' && !sym.init) fail(`'${sym.name}' : const without a value`, line);
    else {
      // a global variable of the shader: main's locals, initialised before main runs
      b = this.newBinding(sym);
      this.globalsMap.set(sym, b);
      if (sym.init) { const saved = this.out; this.out = []; const v = this.expr(sym.init, this.lanes.has(sym)); this.assignBinding(b, sym.type, v); this.prologue.push(...this.out); this.out = saved; }
      return b;
    }
    this.globalsMap.set(sym, b); return b;
  }
  builtinBinding(sym, line) {
    const vs = this.stage === 'vertex';
    switch (sym.builtin) {
      case 'gl_Position': return { st: { name: 'O', base: '0', lanes: null } };
      case 'gl_PointSize': return { st: { name: 'O', base: '4', lanes: null } };
      case 'gl_VertexID': return { st: { name: 'F', base: '0', lanes: null }, readonly: true };
      case 'gl_InstanceID': return { st: { name: 'F', base: '1', lanes: null }, readonly: true };
      case 'gl_FragCoord': { const laned = this.lanes.has(sym); if (laned) this.fragCoordLanes = true; return { st: { name: 'F', base: '0', lanes: laned ? ['F1', 'F2'] : null }, readonly: true }; }
      case 'gl_FrontFacing': return { st: { name: 'F', base: '4', lanes: null }, readonly: true };
      case 'gl_PointCoord': { const laned = this.lanes.has(sym); if (laned) this.pointCoordLanes = true; return { st: { name: 'F', base: '5', lanes: laned ? ['F1', 'F2'] : null }, readonly: true }; }
      case 'gl_FragColor': return { st: { name: 'O', base: '0', lanes: null } };
      case 'gl_FragData': return { st: { name: 'O', base: '0', lanes: null } };
      case 'gl_FragDepth': case 'gl_FragDepthEXT': return { st: { name: 'O', base: '16', lanes: null } };
      case 'gl_DepthRange': { const at = this.layout.uniform(sym); this.usedUniforms.add(sym); return { st: { name: 'U', base: String(at.base), lanes: null }, readonly: true }; }
      default: if (sym.constValue) return { constant: sym.constValue }; fail(`'${sym.name}' : not available in the ${vs ? 'vertex' : 'fragment'} shader`, line);
    }
  }
  newBinding(sym, laned = this.lanes.has(sym)) {
    const t = sym.type;
    if (needsStore(t)) { const n = comps(t); return { st: { name: this.store(n), base: '0', lanes: laned ? [this.store(n), this.store(n)] : null } }; }
    const n = comps(t), names = Array.from({ length: n }, () => this.local());
    return { vars: names, l: laned ? [Array.from({ length: n }, () => this.local()), Array.from({ length: n }, () => this.local())] : null };
  }
  /** The value a binding holds. */
  readBinding(b, t) {
    if (b.constant) return this.val(t, b.constant.map(lit));
    if (b.vars) return this.val(t, b.vars, b.l);
    if (needsStore(t) || t.k === 'array') return { t, st: b.st };
    return this.readStore(b.st, t);
  }
  readStore(st, t, extraBase = 0) {
    const n = comps(t), base = st.base, at = k => (base === '0' || base === 0 ? `${k + extraBase}` : /^\d+$/.test(base) ? `${Number(base) + k + extraBase}` : `${base}+${k + extraBase}`);
    const c = Array.from({ length: n }, (_, k) => `${st.name}[${at(k)}]`);
    return this.val(t, c, st.lanes ? st.lanes.map(name => Array.from({ length: n }, (_, k) => `${name}[${at(k)}]`)) : null);
  }
  /** Writes a value (comps or store) into a binding / l-value of type t. */
  assignBinding(b, t, v) {
    if (b.vars) { const src = this.stable(v, t); b.vars.forEach((name, i) => this.emit(`${name}=${src.c[i]};`)); if (b.l) b.l.forEach((names, k) => names.forEach((name, i) => this.emit(`${name}=${this.lane(src, k + 1)[i]};`))); return; }
    this.writeStore(b.st, t, v);
  }
  /** Copies a value whose components may alias the destination into temps. */
  stable(v, t) {
    if (v.st) return this.readStore(v.st, t);
    const fix = cs => cs.map(c => TEMP.test(c) ? c : this.let(c));
    return this.val(v.t, fix(v.c), v.l ? v.l.map(fix) : null);
  }
  writeStore(st, t, v) {
    const n = comps(t), at = k => (st.base === '0' ? `${k}` : /^\d+$/.test(st.base) ? `${Number(st.base) + k}` : `${st.base}+${k}`);
    if (v.st) {   // store to store: a copy loop (through a scratch copy when source and destination may overlap)
      const src = v.st, i = this.tmp();
      if (src.name === st.name) { const tmpStore = this.store(n); this.emit(`for(let ${i}=0;${i}<${n};${i}++)${tmpStore}[${i}]=${src.name}[${src.base}+${i}];`); this.emit(`for(let ${i}x=0;${i}x<${n};${i}x++)${st.name}[${st.base}+${i}x]=${tmpStore}[${i}x];`); }
      else this.emit(`for(let ${i}=0;${i}<${n};${i}++)${st.name}[${st.base}+${i}]=${src.name}[${src.base}+${i}];`);
      if (st.lanes) st.lanes.forEach((name, k) => { const from = src.lanes?.[k] ?? src.name; this.emit(`for(let ${i}=0;${i}<${n};${i}++)${name}[${st.base}+${i}]=${from}[${src.base}+${i}];`); });
      return;
    }
    const src = this.stable(v, t);
    for (let k = 0; k < n; k++) this.emit(`${st.name}[${at(k)}]=${src.c[k]};`);
    if (st.lanes) st.lanes.forEach((name, j) => { const cs = this.lane(src, j + 1); for (let k = 0; k < n; k++) this.emit(`${name}[${at(k)}]=${cs[k]};`); });
  }

  // ---- functions (inlined) ----
  fnBody(fn) {
    this.fnStack.push({ fn, label: 'MAIN', ret: null });
    this.env.push(new Map());
    for (const s of fn.body.stmts) this.stmt(s);
    this.env.pop(); this.fnStack.pop();
  }
  callUser(e, wantLanes) {
    const fn = e.fn, frame = new Map();
    // arguments, left to right: in values (copied), out / inout l-values
    const ins = [], lvs = [];
    fn.params.forEach((p, i) => {
      const arg = e.args[i];
      if (p.qual === 'out' || p.qual === 'inout') lvs[i] = this.lvalue(arg);
      if (p.qual === 'in' || p.qual === 'inout') ins[i] = p.qual === 'inout' ? this.readLvalue(lvs[i], p.type) : this.expr(arg, p.sym ? this.lanes.has(p.sym) : false);
    });
    fn.params.forEach((p, i) => {
      if (!p.sym) return;
      const laned = this.lanes.has(p.sym);
      // an in parameter the function never writes and whose value is already in temps (or a sampler) is used as it is
      const v = ins[i];
      if (p.type.k === 'sampler' || (v && !p.sym.written && p.qual === 'in' && !v.st && v.c.every(c => TEMP.test(c)) && (!laned || v.l?.every(cs => cs.every(c => TEMP.test(c)))))) { frame.set(p.sym, v.st ? { st: v.st } : { vars: v.c, l: laned ? v.l ?? [v.c, v.c] : null, readonly: true }); return; }
      const b = this.newBinding(p.sym, laned); frame.set(p.sym, b);
      if (v) this.assignBinding(b, p.type, v);
    });
    const retLaned = this.lanes.has(fn.retSym) && wantLanes;
    let ret = null;
    if (fn.ret.k !== 'void') ret = this.newBinding({ type: fn.ret }, this.lanes.has(fn.retSym));
    const single = fn.body.stmts.length === 1 && fn.body.stmts[0].kind === 'Return';
    const label = this.label('F');
    this.env.push(frame); this.fnStack.push({ fn, label, ret, used: false });
    if (single && fn.body.stmts[0].e) { const v = this.expr(fn.body.stmts[0].e, this.lanes.has(fn.retSym)); this.assignBinding(ret, fn.ret, v); }
    else { const start = this.out.length; for (const s of fn.body.stmts) this.stmt(s); const frameInfo = this.fnStack.at(-1); if (frameInfo.used) { this.out.splice(start, 0, `${label}:{`); this.emit('}'); } }
    this.fnStack.pop(); this.env.pop();
    // copy-out
    fn.params.forEach((p, i) => { if ((p.qual === 'out' || p.qual === 'inout') && p.sym) this.writeLvalue(lvs[i], p.type, this.readBinding(frame.get(p.sym), p.type)); });
    if (!ret) return this.val(fn.ret, []);
    const v = this.readBinding(ret, fn.ret);
    if (!retLaned && v.l) return this.val(v.t, v.c, null);
    return v;
  }

  // ---- statements ----
  stmt(s) {
    switch (s.kind) {
      case 'Compound': for (const x of s.stmts) this.stmt(x); return;
      case 'Empty': case 'Precision': return;
      case 'Expr': this.expr(s.e, false); return;
      case 'DeclStmt': {
        const d = s.decl; if (d.kind !== 'VarDecl') return;
        for (const v of d.vars) {
          const sym = v.sym; if (sym.storage === 'const' && sym.constValue && !needsStore(sym.type)) { this.env.at(-1).set(sym, { constant: sym.constValue }); continue; }
          const b = this.newBinding(sym); this.env.at(-1).set(sym, b);
          if (v.init) this.assignBinding(b, sym.type, this.expr(v.init, this.lanes.has(sym)));
        }
        return;
      }
      case 'If': {
        const c = this.cond(s.c); this.emit(`if(${c}){`); this.stmt(s.a); if (s.b) { this.emit('}else{'); this.stmt(s.b); } this.emit('}'); return;
      }
      case 'For': case 'While': case 'DoWhile': return this.loop(s);
      case 'Switch': {
        const v = this.simple(this.expr(s.e, false).c[0]), label = this.label('W');
        this.targets.push({ brk: label, cont: null, kind: 'switch' });
        this.emit(`${label}:switch(${v}){`);
        for (const x of s.body.stmts) {
          if (x.kind === 'Case') { this.emit(`case ${lit(x.e.const[0])}:`); continue; }
          if (x.kind === 'Default') { this.emit('default:'); continue; }
          this.stmt(x);
        }
        this.emit('}'); this.targets.pop(); return;
      }
      case 'Break': { const t = this.targets.at(-1); this.emit(`break ${t.brk};`); return; }
      case 'Continue': { const t = [...this.targets].reverse().find(x => x.kind === 'loop'); t.usedCont = true; this.emit(`break ${t.cont};`); return; }
      case 'Discard': this.emit('return 1;'); return;
      case 'Return': {
        const frame = this.fnStack.at(-1);
        if (s.e) { const v = this.expr(s.e, this.lanes.has(frame.fn.retSym)); if (frame.ret) this.assignBinding(frame.ret, frame.fn.ret, v); }
        frame.used = true; this.emit(`break ${frame.label};`); return;
      }
      default: fail(`'${s.kind}' : statement not supported by the code generator`, s.line);
    }
  }
  cond(e) { const v = this.expr(e, false); return v.c[0]; }
  loop(s) {
    const label = this.label('L'), cont = this.label('C'), guard = this.local('g');
    this.emit(`${guard}=0;`);
    if (s.kind === 'For' && s.init) this.stmt(s.init.kind === 'VarDecl' ? { kind: 'DeclStmt', decl: s.init } : s.init);
    const target = { brk: label, cont, kind: 'loop', usedCont: false }; this.targets.push(target);
    this.emit(`${label}:for(;;){`);
    this.emit(`if(++${guard}>${LOOP_LIMIT}){rt.loopLimit();break;}`);
    const condition = c => {
      if (!c) return;
      if (c.kind === 'CondDecl') { const b = this.newBinding(c.sym); this.env.at(-1).set(c.sym, b); this.assignBinding(b, c.sym.type, this.expr(c.init, false)); this.emit(`if(!${b.vars[0]})break;`); return; }
      this.emit(`if(!${this.cond(c)})break;`);
    };
    if (s.kind !== 'DoWhile') condition(s.c);
    const start = this.out.length;
    this.stmt(s.body);
    if (target.usedCont) { this.out.splice(start, 0, `${cont}:{`); this.emit('}'); }
    if (s.kind === 'For' && s.inc) this.expr(s.inc, false);
    if (s.kind === 'DoWhile') condition(s.c);
    this.emit('}');
    this.targets.pop();
  }

  // ---- l-values ----
  /** An l-value: { t, slots: [js l-value strings | { dyn, options }], lanes: [slots1, slots2] | null } or { t, st } for store types. */
  lvalue(e) {
    switch (e.kind) {
      case 'Ident': {
        const b = this.bindingOf(e.sym, e.line), t = e.sym.type;
        if (b.vars) return { t, slots: [...b.vars], lanes: b.l ? b.l.map(x => [...x]) : null };
        if (needsStore(t)) return { t, st: b.st };
        const v = this.readStore(b.st, t); return { t, slots: v.c, lanes: v.l };
      }
      case 'Field': {
        const base = this.lvalue(e.e);
        if (e.swizzle) return { t: e.type, slots: e.swizzle.map(i => base.slots[i]), lanes: base.lanes ? base.lanes.map(ls => e.swizzle.map(i => ls[i])) : null };
        const n = comps(e.type);
        if (base.st) { const st = { ...base.st, base: this.offset(base.st.base, e.fieldAt) }; if (needsStore(e.type)) return { t: e.type, st }; const v = this.readStore(st, e.type); return { t: e.type, slots: v.c, lanes: v.l }; }
        return { t: e.type, slots: base.slots.slice(e.fieldAt, e.fieldAt + n), lanes: base.lanes ? base.lanes.map(ls => ls.slice(e.fieldAt, e.fieldAt + n)) : null };
      }
      case 'Index': {
        const bt = e.e.type, index = this.indexValue(e);
        if (bt.k === 'array') {
          const base = this.lvalue(e.e), stride = comps(bt.e);
          const at = typeof index === 'number' ? this.offset(base.st.base, index * stride) : this.let(`${base.st.base === '0' ? '' : `${base.st.base}+`}${stride === 1 ? index : `${index}*${stride}`}`);
          const st = { ...base.st, base: at };
          if (needsStore(bt.e)) return { t: bt.e, st };
          const v = this.readStore(st, bt.e); return { t: bt.e, slots: v.c, lanes: v.l };
        }
        const base = this.lvalue(e.e);
        if (bt.k === 'vector') {
          if (typeof index === 'number') return { t: e.type, slots: [base.slots[index]], lanes: base.lanes ? base.lanes.map(ls => [ls[index]]) : null };
          return { t: e.type, slots: [{ dyn: index, options: base.slots }], lanes: base.lanes ? base.lanes.map(ls => [{ dyn: index, options: ls }]) : null };
        }
        // matrix column
        const r = bt.r;
        if (typeof index === 'number') return { t: e.type, slots: base.slots.slice(index * r, index * r + r), lanes: base.lanes ? base.lanes.map(ls => ls.slice(index * r, index * r + r)) : null };
        const col = (ls) => Array.from({ length: r }, (_, row) => ({ dyn: index, options: Array.from({ length: bt.c }, (_, c) => ls[c * r + row]) }));
        return { t: e.type, slots: col(base.slots), lanes: base.lanes ? base.lanes.map(col) : null };
      }
      default: fail("'assign' : l-value required", e.line);
    }
  }
  offset(base, k) { if (!k) return base; if (/^\d+$/.test(base)) return String(Number(base) + k); return this.let(`${base}+${k}`); }
  readSlot(slot) { return typeof slot === 'string' ? slot : this.let(slot.options.map((o, i) => i < slot.options.length - 1 ? `${slot.dyn}===${i}?${typeof o === 'string' ? o : this.readSlot(o)}:` : (typeof o === 'string' ? o : this.readSlot(o))).join('')); }
  writeSlot(slot, value) {
    if (typeof slot === 'string') { this.emit(`${slot}=${value};`); return; }
    this.emit(`switch(${slot.dyn}){${slot.options.map((o, i) => `case ${i}:${typeof o === 'string' ? `${o}=${value};` : ''}break;`).join('')}}`);
  }
  readLvalue(lv, t) {
    if (lv.st) return needsStore(t) ? { t, st: lv.st } : this.readStore(lv.st, t);
    return this.val(t, lv.slots.map(s => this.readSlot(s)), lv.lanes ? lv.lanes.map(ls => ls.map(s => this.readSlot(s))) : null);
  }
  writeLvalue(lv, t, v) {
    if (lv.st) { if (needsStore(t)) return this.writeStore(lv.st, t, v); }
    if (lv.st) return this.writeStore(lv.st, t, v);
    const src = this.stable(v, t);
    lv.slots.forEach((slot, i) => this.writeSlot(slot, src.c[i]));
    if (lv.lanes) lv.lanes.forEach((ls, k) => ls.forEach((slot, i) => this.writeSlot(slot, this.lane(src, k + 1)[i])));
  }
  /** The index of an Index node: a number when constant, else a temp clamped to the range (out-of-range indices read the nearest element, as WebGL's robust access does). */
  indexValue(e) {
    const bt = e.e.type, size = bt.k === 'array' ? bt.len : bt.k === 'vector' ? bt.n : bt.c;
    if (e.index.const) return e.index.const[0];
    const i = this.simple(this.expr(e.index, false).c[0]);
    return this.let(`(${i}<0?0:${i}>${size - 1}?${size - 1}:${i})`);
  }

  // ---- expressions ----
  /** Generates an expression; wantLanes asks for the x+1 / y+1 lanes where the value has them. */
  expr(e, wantLanes = false) {
    switch (e.kind) {
      case 'Num': return this.val(e.type ?? FLOAT, [lit(e.const[0])]);
      case 'Ident': {
        if (e.const && !needsStore(e.type) && !(e.sym.storage === 'uniform')) return this.val(e.type, e.const.map(lit));
        const b = this.bindingOf(e.sym, e.line), v = this.readBinding(b, e.sym.type);
        return wantLanes || !v.l ? v : this.val(v.t, v.c, null);
      }
      case 'Comma': this.expr(e.l, false); return this.expr(e.r, wantLanes);
      case 'Field': {
        const base = this.expr(e.e, wantLanes);
        if (e.swizzle) return this.val(e.type, e.swizzle.map(i => base.c[i]), base.l ? base.l.map(cs => e.swizzle.map(i => cs[i])) : null);
        const n = comps(e.type);
        if (base.st) { const st = { ...base.st, base: this.offset(base.st.base, e.fieldAt), lanes: wantLanes ? base.st.lanes : null }; return needsStore(e.type) ? { t: e.type, st } : this.readStore(st, e.type); }
        return this.val(e.type, base.c.slice(e.fieldAt, e.fieldAt + n), base.l ? base.l.map(cs => cs.slice(e.fieldAt, e.fieldAt + n)) : null);
      }
      case 'Index': return this.index(e, wantLanes);
      case 'Length': return this.val(INT, [lit(e.const[0])]);
      case 'Unary': return this.unary(e, wantLanes);
      case 'Binary': return this.binary(e, wantLanes);
      case 'Ternary': {
        const c = this.cond(e.c), t = e.type;
        if (needsStore(t)) { const n = comps(t), st = { name: this.store(n), base: '0', lanes: null }; this.emit(`if(${c}){`); this.writeStore(st, t, this.expr(e.a)); this.emit('}else{'); this.writeStore(st, t, this.expr(e.b)); this.emit('}'); return { t, st }; }
        const n = comps(t);
        // evaluate both arms into the same locals
        const names = Array.from({ length: n }, () => this.local()), laneNames = wantLanes ? [Array.from({ length: n }, () => this.local()), Array.from({ length: n }, () => this.local())] : null;
        const arm = x => { const v = this.expr(x, wantLanes); names.forEach((name, i) => this.emit(`${name}=${v.c[i]};`)); if (laneNames) laneNames.forEach((ls, k) => ls.forEach((name, i) => this.emit(`${name}=${this.lane(v, k + 1)[i]};`))); };
        this.emit(`if(${c}){`); arm(e.a); this.emit('}else{'); arm(e.b); this.emit('}');
        return this.val(t, names.map(nm => this.let(nm)), laneNames ? laneNames.map(ls => ls.map(nm => this.let(nm))) : null);
      }
      case 'Assign': return this.assign(e, wantLanes);
      case 'Prefix': case 'Postfix': {
        const lv = this.lvalue(e.e), t = e.e.type, old = this.stable(this.readLvalue(lv, t), t);
        const one = t.b === 'float' ? '1' : '1', op = e.op === '++' ? '+' : '-';
        const next = this.cw(t, [old], x => this.wrap(t.b, `${x}${op}${one}`));
        this.writeLvalue(lv, t, next);
        return e.kind === 'Prefix' ? next : old;
      }
      case 'Call': {
        if (e.ctor) return this.construct(e, wantLanes);
        if (e.fn) return this.callUser(e, wantLanes);
        return this.builtin(e, wantLanes);
      }
      default: fail(`'${e.kind}' : expression not supported by the code generator`, e.line);
    }
  }
  wrap(b, expr) { return b === 'int' ? `(${expr})|0` : b === 'uint' ? `(${expr})>>>0` : expr; }
  index(e, wantLanes) {
    const bt = e.e.type, index = this.indexValue(e);
    if (bt.k === 'array') {
      const base = this.expr(e.e, wantLanes);
      const stride = comps(bt.e);
      if (!base.st) {   // a constant array folded into components
        if (typeof index === 'number') return this.val(e.type, base.c.slice(index * stride, index * stride + stride));
        const store = this.store(base.c.length); base.c.forEach((c, i) => this.stores.push(`${store}[${i}]=${c};`));
        return this.readStore({ name: store, base: this.let(`${index}*${stride}`), lanes: null }, e.type);
      }
      const at = typeof index === 'number' ? this.offset(base.st.base, index * stride) : this.let(`${base.st.base === '0' ? '' : `${base.st.base}+`}${stride === 1 ? index : `${index}*${stride}`}`);
      const st = { ...base.st, base: at, lanes: wantLanes ? base.st.lanes : null };
      return needsStore(bt.e) ? { t: bt.e, st } : this.readStore(st, bt.e);
    }
    const base = this.expr(e.e, wantLanes);
    const pick = (cs, list) => typeof index === 'number' ? list.map(i => cs[i]) : list.map(options => this.let(options.map((o, i) => i < options.length - 1 ? `${index}===${i}?${cs[o]}:` : cs[o]).join('')));
    if (bt.k === 'vector') {
      const list = typeof index === 'number' ? [index] : [Array.from({ length: bt.n }, (_, i) => i)];
      return this.val(e.type, pick(base.c, list), base.l ? base.l.map(cs => pick(cs, list)) : null);
    }
    const r = bt.r;
    const list = typeof index === 'number' ? Array.from({ length: r }, (_, row) => index * r + row) : Array.from({ length: r }, (_, row) => Array.from({ length: bt.c }, (_, c) => c * r + row));
    return this.val(e.type, pick(base.c, list), base.l ? base.l.map(cs => pick(cs, list)) : null);
  }
  unary(e, wantLanes) {
    const v = this.expr(e.e, wantLanes), t = e.type;
    switch (e.op) {
      case '+': return v;
      case '-': return this.cw(t, [v], x => t.b === 'float' ? `-${x}` : this.wrap(t.b, `-${x}`), wantLanes);
      case '!': return this.cw(t, [v], x => `1-${x}`, false);
      case '~': return this.cw(t, [v], x => this.wrap(t.b, `~${x}`), false);
    }
  }
  binary(e, wantLanes) {
    const op = e.op;
    if (op === '&&' || op === '||') {   // short-circuit: the right operand runs only when needed
      const l = this.cond(e.l), result = this.local();
      this.emit(`${result}=${l};`); this.emit(op === '&&' ? `if(${result}){` : `if(!${result}){`); this.emit(`${result}=${this.cond(e.r)};`); this.emit('}');
      return this.val(BOOL, [this.let(result)]);
    }
    const l = this.expr(e.l, wantLanes), r = this.expr(e.r, wantLanes);
    return this.operate(op, l, r, e.l.type, e.r.type, e.type, wantLanes);
  }
  /** A binary operator on two values of the given types. */
  operate(op, l, r, lt, rt, t, wantLanes = true) {
    if (op === '==' || op === '!=') {
      const ls = l.st ? this.readStore(l.st, lt) : l, rs = r.st ? this.readStore(r.st, rt) : r;
      const parts = ls.c.map((c, i) => `${c}===${rs.c[i]}`);
      return this.val(BOOL, [this.let(op === '==' ? `+(${parts.join('&&')})` : `+!(${parts.join('&&')})`)]);
    }
    if (op === '^^') return this.val(BOOL, [this.let(`+(${l.c[0]}!==${r.c[0]})`)]);
    if (['<', '>', '<=', '>='].includes(op)) return this.val(BOOL, [this.let(`+(${l.c[0]}${op}${r.c[0]})`)]);
    if (op === '*' && (lt.k === 'matrix' || rt.k === 'matrix') && !(lt.k === 'scalar' || rt.k === 'scalar')) return this.matMul(l, r, lt, rt, t, wantLanes);
    const b = t.b;
    const f = {
      '+': (x, y) => this.wrap(b, `${x}+${y}`), '-': (x, y) => this.wrap(b, `${x}-${y}`),
      '*': (x, y) => b === 'float' ? `${x}*${y}` : b === 'int' ? `Math.imul(${x},${y})` : `Math.imul(${x},${y})>>>0`,
      '/': (x, y) => b === 'float' ? `${x}/${y}` : b === 'int' ? `(${x}/${y})|0` : `(${x}/${y})>>>0`,
      '%': (x, y) => b === 'int' ? `(${x}%${y})|0` : `(${x}%${y})>>>0`,
      '&': (x, y) => this.wrap(b, `${x}&${y}`), '|': (x, y) => this.wrap(b, `${x}|${y}`), '^': (x, y) => this.wrap(b, `${x}^${y}`),
      '<<': (x, y) => this.wrap(b, `${x}<<${y}`), '>>': (x, y) => b === 'uint' ? `${x}>>>${y}` : `${x}>>${y}`,
    }[op];
    if (!f) fail(`'${op}' : operator not supported by the code generator`, 0);
    return this.cw(t, [l, r], f, wantLanes && b === 'float');
  }
  matMul(l, r, lt, rt, t, wantLanes) {
    const fn = (ls) => {
      const [a, b] = ls, out = [];
      if (lt.k === 'matrix' && rt.k === 'matrix') { for (let c = 0; c < rt.c; c++) for (let row = 0; row < lt.r; row++) out.push(Array.from({ length: lt.c }, (_, k) => `${a[k * lt.r + row]}*${b[c * rt.r + k]}`).join('+')); }
      else if (lt.k === 'matrix') { for (let row = 0; row < lt.r; row++) out.push(Array.from({ length: lt.c }, (_, k) => `${a[k * lt.r + row]}*${b[k]}`).join('+')); }
      else { for (let c = 0; c < rt.c; c++) out.push(Array.from({ length: rt.r }, (_, k) => `${a[k]}*${b[c * rt.r + k]}`).join('+')); }
      return out;
    };
    return this.lanewise(t, [l, r], fn, wantLanes);
  }
  assign(e, wantLanes) {
    const t = e.l.type;
    const root = x => x.kind === 'Ident' ? x.sym : root(x.e);
    const laned = this.lanes.has(root(e.l));
    if (e.op === '=') {
      const v = this.expr(e.r, laned);
      const lv = this.lvalue(e.l);
      this.writeLvalue(lv, t, v);
      return v.st ? v : this.stable(v, t);
    }
    const lv = this.lvalue(e.l), current = this.readLvalue(lv, t), r = this.expr(e.r, laned);
    const op = e.op.slice(0, -1), result = this.operate(op, current, r, t, e.r.type, t, laned);
    this.writeLvalue(lv, t, result);
    void wantLanes; return result;
  }
  construct(e, wantLanes) {
    const t = e.ctorType;
    const args = e.args.map(a => this.expr(a, wantLanes));
    if (e.const && !needsStore(t)) return this.val(t, e.const.map(lit));
    if (t.k === 'array' || needsStore(t)) {
      const n = comps(t), laned = wantLanes && args.some(a => a.l || a.st?.lanes);
      const st = { name: this.store(n), base: '0', lanes: laned ? [this.store(n), this.store(n)] : null };
      let at = 0;
      args.forEach((a, i) => { const at_ = at; const ft = t.k === 'array' ? t.e : t.fields[i].type; const dst = { ...st, base: String(at_) }; if (a.st || needsStore(ft)) this.writeStore(dst, ft, a); else this.writeStore(dst, ft, a); at += comps(ft); });
      return { t, st };
    }
    if (t.k === 'struct') {
      const parts = args.map((a, i) => a.st ? this.readStore(a.st, t.fields[i].type) : a);
      const laned = parts.some(p => p.l);
      return this.val(t, parts.flatMap(p => p.c), laned ? [1, 2].map(k => parts.flatMap(p => this.lane(p, k))) : null);
    }
    const convert = (x, from) => {
      const b = t.b; if (from === b) return x;
      if (b === 'float') return x;                                  // int, uint and bool are exact as doubles
      if (b === 'bool') return `+(${x}!==0)`;
      if (b === 'int') return from === 'float' ? `(${x})|0` : from === 'uint' ? `${x}|0` : x;
      return from === 'float' ? `(${x}<0?0:${x}>4294967295?4294967295:${x})>>>0` : from === 'int' ? `${x}>>>0` : x;
    };
    const laned = wantLanes && args.some(a => a.l) && t.b === 'float';
    const build = k => {
      const flat = []; for (let i = 0; i < args.length; i++) { const cs = this.lane(args[i], k); for (const c of cs) flat.push({ c, b: e.args[i].type.b }); }
      const n = comps(t);
      if (t.k === 'scalar') return [this.let(convert(flat[0].c, flat[0].b))];
      if (t.k === 'vector') { if (flat.length === 1) { const x = this.simple(convert(flat[0].c, flat[0].b)); return Array(t.n).fill(x); } return flat.slice(0, n).map(x => this.simple(convert(x.c, x.b))); }
      // matrices
      if (args.length === 1 && e.args[0].type.k === 'matrix') { const m = e.args[0].type, cs = this.lane(args[0], k), out = []; for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) out.push(c < m.c && r < m.r ? cs[c * m.r + r] : c === r ? '1' : '0'); return out; }
      if (flat.length === 1) { const x = this.simple(convert(flat[0].c, flat[0].b)); const out = []; for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) out.push(c === r ? x : '0'); return out; }
      return flat.slice(0, n).map(x => this.simple(convert(x.c, x.b)));
    };
    return this.val(t, build(0), laned ? [build(1), build(2)] : null);
  }

  // ---- built-in functions ----
  builtin(e, wantLanes) {
    const sig = e.builtin, name = sig.name, t = sig.ret;
    if (name.startsWith('texture') || name.startsWith('texel')) return this.texture(e, wantLanes);
    if (name === 'dFdx' || name === 'dFdy' || name === 'fwidth') {
      const v = this.expr(e.args[0], true);
      if (!v.l) return this.val(t, v.c.map(() => '0'));
      const dx = () => v.c.map((c, i) => this.let(`(${v.l[0][i]}-${c})*F[8]`)), dy = () => v.c.map((c, i) => this.let(`(${v.l[1][i]}-${c})*F[9]`));   // the lanes are the other pixel of the 2x2 quad; F[8] / F[9] its side
      if (name === 'dFdx') return this.val(t, dx()); if (name === 'dFdy') return this.val(t, dy());
      const x = dx(), y = dy(); return this.val(t, x.map((a, i) => this.let(`Math.abs(${a})+Math.abs(${y[i]})`)));
    }
    if (name === 'modf') {
      const x = this.expr(e.args[0], wantLanes), lv = this.lvalue(e.args[1]);
      const whole = this.cw(t, [x], a => `Math.trunc(${a})`, wantLanes); this.writeLvalue(lv, t, whole);
      return this.cw(t, [x, whole], (a, w) => `${a}-${w}`, wantLanes);
    }
    const args = e.args.map(a => this.expr(a, wantLanes)), types = e.args.map(a => a.type), b = t.b;
    const lw = (fn) => this.lanewise(t, args, fn, wantLanes);
    const UNARY = {
      radians: x => `${x}*0.017453292519943295`, degrees: x => `${x}*57.29577951308232`, sin: x => `Math.sin(${x})`, cos: x => `Math.cos(${x})`, tan: x => `Math.tan(${x})`, asin: x => `Math.asin(${x})`,
      acos: x => `Math.acos(${x})`, exp: x => `Math.exp(${x})`, log: x => `Math.log(${x})`, exp2: x => `Math.pow(2,${x})`, log2: x => `Math.log2(${x})`, sqrt: x => `Math.sqrt(${x})`,
      inversesqrt: x => `1/Math.sqrt(${x})`, floor: x => `Math.floor(${x})`, ceil: x => `Math.ceil(${x})`, fract: x => `${x}-Math.floor(${x})`, trunc: x => `Math.trunc(${x})`,
      round: x => `rt.round(${x})`, roundEven: x => `rt.roundEven(${x})`, sinh: x => `Math.sinh(${x})`, cosh: x => `Math.cosh(${x})`, tanh: x => `Math.tanh(${x})`, asinh: x => `Math.asinh(${x})`,
      acosh: x => `Math.acosh(${x})`, atanh: x => `Math.atanh(${x})`, isnan: x => `+(${x}!==${x})`, isinf: x => `+(${x}===Infinity||${x}===-Infinity)`,
      floatBitsToInt: x => `rt.fbi(${x})`, floatBitsToUint: x => `rt.fbu(${x})`, intBitsToFloat: x => `rt.ibf(${x})`, uintBitsToFloat: x => `rt.ubf(${x})`,
    };
    if (UNARY[name]) return this.cw(t, args, UNARY[name], wantLanes && b === 'float' && !['isnan', 'isinf', 'floatBitsToInt', 'floatBitsToUint'].includes(name));
    switch (name) {
      case 'atan': return args.length === 2 ? this.cw(t, args, (y, x) => `Math.atan2(${y},${x})`, wantLanes) : this.cw(t, args, x => `Math.atan(${x})`, wantLanes);
      case 'pow': return this.cw(t, args, (x, y) => `Math.pow(${x},${y})`, wantLanes);
      case 'abs': return this.cw(t, args, x => b === 'int' ? `Math.abs(${x})|0` : `Math.abs(${x})`, wantLanes && b === 'float');
      case 'sign': return this.cw(t, args, x => `Math.sign(${x})`, wantLanes && b === 'float');
      case 'mod': return this.cw(t, args, (x, y) => `${x}-${y}*Math.floor(${x}/${y})`, wantLanes);
      case 'min': return this.cw(t, args, (x, y) => `(${y}<${x}?${y}:${x})`, wantLanes && b === 'float');
      case 'max': return this.cw(t, args, (x, y) => `(${y}>${x}?${y}:${x})`, wantLanes && b === 'float');
      case 'clamp': return this.cw(t, args, (x, lo, hi) => { const m = this.let(`(${lo}>${x}?${lo}:${x})`); return `(${hi}<${m}?${hi}:${m})`; }, wantLanes && b === 'float');
      case 'mix': if (types[2].b === 'bool') return this.cw(t, args, (x, y, a) => `(${a}?${y}:${x})`, wantLanes); return this.cw(t, args, (x, y, a) => `${x}*(1-${a})+${y}*${a}`, wantLanes);
      case 'step': return this.cw(t, args, (edge, x) => `(${x}<${edge}?0:1)`, false);
      case 'smoothstep': return this.cw(t, args, (e0, e1, x) => { const u = this.let(`(${x}-${e0})/(${e1}-${e0})`), c = this.let(`(${u}<0?0:${u}>1?1:${u})`); return `${c}*${c}*(3-2*${c})`; }, wantLanes);
      case 'length': return lw(([x]) => [`Math.sqrt(${x.map(c => `${c}*${c}`).join('+')})`]);
      case 'distance': return lw(([x, y]) => { const d = x.map((c, i) => this.let(`${c}-${y[i]}`)); return [`Math.sqrt(${d.map(c => `${c}*${c}`).join('+')})`]; });
      case 'dot': return lw(([x, y]) => [x.map((c, i) => `${c}*${y[i]}`).join('+')]);
      case 'cross': return lw(([a, c]) => [`${a[1]}*${c[2]}-${a[2]}*${c[1]}`, `${a[2]}*${c[0]}-${a[0]}*${c[2]}`, `${a[0]}*${c[1]}-${a[1]}*${c[0]}`]);
      case 'normalize': return lw(([x]) => { const inv = this.let(`1/Math.sqrt(${x.map(c => `${c}*${c}`).join('+')})`); return x.map(c => `${c}*${inv}`); });
      case 'faceforward': return lw(([n, i, nref]) => { const d = this.let(nref.map((c, k) => `${c}*${i[k]}`).join('+')); return n.map(c => `(${d}<0?${c}:-${c})`); });
      case 'reflect': return lw(([i, n]) => { const d = this.let(n.map((c, k) => `${c}*${i[k]}`).join('+')); return i.map((c, k) => `${c}-2*${d}*${n[k]}`); });
      case 'refract': return lw(([i, n, [eta]]) => {
        const d = this.let(n.map((c, k) => `${c}*${i[k]}`).join('+')), k = this.let(`1-${eta}*${eta}*(1-${d}*${d})`), s = this.let(`${eta}*${d}+Math.sqrt(${k})`);
        return i.map((c, j) => `(${k}<0?0:${eta}*${c}-${s}*${n[j]})`);
      });
      case 'matrixCompMult': return this.cw(t, args, (x, y) => `${x}*${y}`, wantLanes);
      case 'outerProduct': return lw(([c, r]) => { const out = []; for (let j = 0; j < t.c; j++) for (let i = 0; i < t.r; i++) out.push(`${c[i]}*${r[j]}`); return out; });
      case 'transpose': return lw(([m]) => { const src = types[0], out = []; for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) out.push(m[r * src.r + c]); return out; });
      case 'determinant': return lw(([m]) => [determinant(m, types[0].c)]);
      case 'inverse': return lw(([m]) => inverse(this, m, types[0].c));
      case 'lessThan': return this.cw(t, args, (x, y) => `+(${x}<${y})`, false); case 'lessThanEqual': return this.cw(t, args, (x, y) => `+(${x}<=${y})`, false);
      case 'greaterThan': return this.cw(t, args, (x, y) => `+(${x}>${y})`, false); case 'greaterThanEqual': return this.cw(t, args, (x, y) => `+(${x}>=${y})`, false);
      case 'equal': return this.cw(t, args, (x, y) => `+(${x}===${y})`, false); case 'notEqual': return this.cw(t, args, (x, y) => `+(${x}!==${y})`, false);
      case 'any': return this.val(BOOL, [this.let(`+(${args[0].c.join('||')})`)]); case 'all': return this.val(BOOL, [this.let(`+(${args[0].c.join('&&')})`)]);
      case 'not': return this.cw(t, args, x => `1-${x}`, false);
      case 'packSnorm2x16': case 'packUnorm2x16': case 'packHalf2x16': return this.val(UINT, [this.let(`rt.${name}(${args[0].c[0]},${args[0].c[1]})`)]);
      case 'unpackSnorm2x16': case 'unpackUnorm2x16': case 'unpackHalf2x16': this.emit(`rt.${name}(${args[0].c[0]});`); return this.val(t, [this.let('R[0]'), this.let('R[1]')]);
    }
    fail(`'${name}' : built-in function not supported by the code generator`, e.line);
  }
  /** The texture functions (ES 3.00 8.8, ES 1.00 8.7): coordinates, level selection and the sampler call; results land in R. */
  texture(e, wantLanes) {
    let name = e.builtin.name;
    const samplerType = e.args[0].type;
    name = name.replace(/^texture2D|^textureCube/, 'texture').replace(/EXT$/, '');
    const sv = this.expr(e.args[0], false), unit = sv.c[0];
    const table = samplerType.dim === 2 ? 'S2' : samplerType.dim === 3 ? 'S3' : samplerType.dim === 'cube' ? 'SC' : 'SA';
    const st = `${table}[${unit}]`;
    if (name === 'textureSize') { const lod = this.expr(e.args[1], false).c[0]; this.emit(`${st}.size(${lod});`); return this.val(e.builtin.ret, Array.from({ length: comps(e.builtin.ret) }, (_, i) => this.let(`R[${i}]`))); }
    const proj = name.includes('Proj'), fetch = name.startsWith('texel'), lodCall = name.includes('Lod'), grad = name.includes('Grad'), offsetCall = name.includes('Offset');
    const shadow = !!samplerType.shadow, dims = samplerType.dim === 2 ? 2 : 3;
    const fragmentImplicit = this.stage === 'fragment' && !lodCall && !grad && !fetch;
    const coordArg = e.args[1], coord = this.expr(coordArg, fragmentImplicit), n = comps(coordArg.type);
    // projected coordinates per lane: [s, t, r|layer, ref]
    const project = cs => {
      if (!proj) return cs;
      const q = cs[n - 1], inv = this.let(`1/${q}`);
      if (shadow) return [this.let(`${cs[0]}*${inv}`), this.let(`${cs[1]}*${inv}`), '0', this.let(`${cs[2]}*${inv}`)];   // sampler2DShadow, vec4 (s, t, ref, q)
      if (dims === 2) return [this.let(`${cs[0]}*${inv}`), this.let(`${cs[1]}*${inv}`)];
      return [this.let(`${cs[0]}*${inv}`), this.let(`${cs[1]}*${inv}`), this.let(`${cs[2]}*${inv}`)];
    };
    const c0 = project(coord.c);
    let mode = 0, at = 2;
    if (fetch) mode |= MODE.FETCH;
    for (let i = 0; i < 4; i++) this.emit(`P[${i}]=${c0[i] ?? '0'};`);
    if (shadow) { mode |= MODE.COMPARE; if (!proj) { const ref = samplerType.dim === 2 ? c0[2] : c0[3]; this.emit(`P[3]=${ref};`); if (samplerType.dim === 2) this.emit('P[2]=0;'); } }
    if (fetch) { const lod = this.expr(e.args[at++], false).c[0]; this.emit(`P[11]=${lod};`); }
    else if (lodCall) { mode |= MODE.LOD; const lod = this.expr(e.args[at++], false).c[0]; this.emit(`P[11]=${lod};`); }
    else if (grad) {
      mode |= MODE.GRAD; const dx = this.expr(e.args[at++], false).c, dy = this.expr(e.args[at++], false).c;
      for (let i = 0; i < 3; i++) { this.emit(`P[${4 + i}]=${dx[i] ?? '0'};`); this.emit(`P[${7 + i}]=${dy[i] ?? '0'};`); }
    } else if (this.stage === 'fragment') {
      mode |= MODE.GRAD;
      if (coord.l) {
        const c1 = project(coord.l[0]), c2 = project(coord.l[1]), k = samplerType.dim === 'cube' ? 3 : samplerType.dim === 3 ? 3 : 2;
        for (let i = 0; i < 3; i++) { this.emit(`P[${4 + i}]=${i < k ? `${c1[i]}-${c0[i]}` : '0'};`); this.emit(`P[${7 + i}]=${i < k ? `${c2[i]}-${c0[i]}` : '0'};`); }
      } else for (let i = 4; i < 10; i++) this.emit(`P[${i}]=0;`);
    } else { mode |= MODE.LOD; this.emit('P[11]=0;'); }   // a vertex shader has no derivatives: the base level
    if (offsetCall) { mode |= MODE.OFFSET; const off = this.expr(e.args[at++], false).c; for (let i = 0; i < 3; i++) this.emit(`P[${12 + i}]=${off[i] ?? '0'};`); }
    if (at < e.args.length) { mode |= MODE.BIAS; const bias = this.expr(e.args[at++], false).c[0]; this.emit(`P[10]=${bias};`); }
    this.emit(`${st}.sample(${mode});`);
    const rt = e.builtin.ret, count = comps(rt);
    void wantLanes;
    return this.val(rt, Array.from({ length: count }, (_, i) => this.let(`R[${i}]`)));
  }
}

// ---- matrix helpers ----
function determinant(m, n) {
  const at = (c, r) => m[c * n + r];
  if (n === 2) return `${at(0, 0)}*${at(1, 1)}-${at(1, 0)}*${at(0, 1)}`;
  if (n === 3) return `${at(0, 0)}*(${at(1, 1)}*${at(2, 2)}-${at(2, 1)}*${at(1, 2)})-${at(1, 0)}*(${at(0, 1)}*${at(2, 2)}-${at(2, 1)}*${at(0, 2)})+${at(2, 0)}*(${at(0, 1)}*${at(1, 2)}-${at(1, 1)}*${at(0, 2)})`;
  const minor = (skipC, skipR) => { const cols = [0, 1, 2, 3].filter(c => c !== skipC), rows = [0, 1, 2, 3].filter(r => r !== skipR); const sub = []; for (const c of cols) for (const r of rows) sub.push(at(c, r)); return `(${determinant(sub, 3)})`; };
  return [0, 1, 2, 3].map(c => `${c % 2 ? '-' : '+'}${at(c, 0)}*${minor(c, 0)}`).join('');
}
function inverse(g, m, n) {
  const det = g.let(determinant(m, n)), inv = g.let(`1/${det}`), out = [];
  const at = (c, r) => m[c * n + r];
  for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) {
    // inverse[c][r] = cofactor(r, c) / det (the adjugate is the transposed cofactor matrix)
    const cols = [...Array(n).keys()].filter(x => x !== r), rows = [...Array(n).keys()].filter(x => x !== c), sub = [];
    for (const cc of cols) for (const rr of rows) sub.push(at(cc, rr));
    const minor = n === 2 ? sub[0] : determinant(sub, n - 1), sign = (r + c) % 2 ? '-' : '';
    out.push(`${sign}(${minor})*${inv}`);
  }
  return out;
}
export { coerce, isInteger, containsSampler, fieldOffset, vec, mat, FLOAT, INT, UINT };
