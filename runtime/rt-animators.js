import { APKError } from './apk-error.js?v=0c9f1b0d2456';
import { getVectorGraphics } from './vector-native.js?v=0c9f1b0d2456';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=0c9f1b0d2456';

// The RenderThread animation system behind android.graphics.animation.RenderNodeAnimator (hwui BaseRenderNodeAnimator / CanvasPropertyPrimitiveAnimator /
// CanvasPropertyPaintAnimator / RenderPropertyAnimator and the NativeInterpolatorFactory interpolators). The original Java (RenderNodeAnimator, FallbackLUTInterpolator,
// RippleAnimationSession ...) runs from framework.dex; only the native animators live here:
//   * an animator is staged by nStart and begins at the first Choreographer frame that sees it (its start time is that frame's time, like hwui's pushStaging/animate),
//   * every frame the animators advance with the frame time, write their value into the CanvasProperty / RenderNode property, and a finished animator calls back
//     RenderNodeAnimator.callOnFinished (which posts onFinished to its async Handler),
//   * while any animator runs, a frame is requested and the windows are redrawn so the recorded display lists replay with the new property values.
const ANIMATOR = 'Landroid/graphics/animation/RenderNodeAnimator;', NODE = 'Landroid/graphics/RenderNode;', FACTORY = 'Landroid/graphics/animation/NativeInterpolatorFactory;';
const fail = message => { throw new APKError(message, { kind: 'render-thread-animator' }); };
const bits = new DataView(new ArrayBuffer(4)), decode = v => { bits.setInt32(0, v | 0, true); return bits.getFloat32(0, true); };
// RenderNodeAnimator property ids -> RenderNode store keys (hwui RenderPropertyAnimator)
const NODE_PROPERTY = ['translationX', 'translationY', 'translationZ', 'scaleX', 'scaleY', 'rotation', 'rotationX', 'rotationY', 'x', 'y', 'z', 'alpha'];

const bounce = t => t * t * 8;
const INTERPOLATORS = {
  linear: () => x => x,
  accelerateDecelerate: () => x => Math.cos((x + 1) * Math.PI) / 2 + 0.5,
  accelerate: factor => x => factor === 1 ? x * x : Math.pow(x, 2 * factor),
  decelerate: factor => x => factor === 1 ? 1 - (1 - x) * (1 - x) : 1 - Math.pow(1 - x, 2 * factor),
  anticipate: tension => x => x * x * ((tension + 1) * x - tension),
  anticipateOvershoot: tension => { const a = (t, s) => t * t * ((s + 1) * t - s), o = (t, s) => t * t * ((s + 1) * t + s), k = tension * 1.5; return x => x < 0.5 ? 0.5 * a(x * 2, k) : 0.5 * (o(x * 2 - 2, k) + 2); },
  overshoot: tension => x => { x -= 1; return x * x * ((tension + 1) * x + tension) + 1; },
  bounce: () => x => { x *= 1.1226; return x < 0.3535 ? bounce(x) : x < 0.7408 ? bounce(x - 0.54719) + 0.7 : x < 0.9644 ? bounce(x - 0.8526) + 0.9 : bounce(x - 1.0435) + 0.95; },
  cycle: cycles => x => Math.sin(2 * Math.PI * cycles * x),
  path: (xs, ys) => x => {   // hwui PathInterpolator: binary search of the sampled path, linear within a segment
    if (x <= 0) return ys[0]; if (x >= 1) return ys[ys.length - 1];
    let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const dx = xs[hi] - xs[lo]; return dx === 0 ? ys[lo] : ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / dx;
  },
  lut: values => x => { const pos = Math.max(0, Math.min(1, x)) * (values.length - 1), i = Math.min(values.length - 2, Math.floor(pos)); return values.length < 2 ? values[0] : values[i] + (values[i + 1] - values[i]) * (pos - i); },
};

export function createRenderThreadAnimators(platform) {
  const animators = gcRoot(new Map()), interpolators = new Map();
  let next = 0x7b000000n, running = 0, frameRequested = false;
  const graphics = runtime => getVectorGraphics(runtime);
  // Animator tokens live in the shared VM graphics-handle table, whose VirtualRefBasePtr.nIncStrong / nDecStrong natives (vector-native.js) own the reference counting.
  let current = null;
  const create = (kind, fields) => { const g = graphics(current); const id = g.create('rtAnimator', { animatorKind: kind, state: 'prepare', duration: 300, delay: 0, interpolator: INTERPOLATORS.linear(), startValue: null, listenerRef: null, target: null, startTime: null, from: 0, ...fields }); animators.set(id, true); return id; };
  const get = id => { const a = graphics(current).get(BigInt(id), 'rtAnimator'); a.id = BigInt(id); return a; };
  const newInterpolator = fn => { const id = next++; interpolators.set(id, fn); return id; };
  // ---- the property each animator writes -----------------------------------------------------------------------------------------------------------------
  const read = (runtime, a) => {
    if (a.animatorKind === 'cpFloat') return graphics(runtime).get(a.propHandle).value;
    if (a.animatorKind === 'cpPaint') { const paint = graphics(runtime).get(a.propHandle).paint; return a.paintField === 0 ? paint.strokeWidth : (paint.argb >>> 24); }
    const node = platform.rtNodeState(runtime, a.target), key = NODE_PROPERTY[a.property];
    return key === 'x' ? node.left + node.translationX : key === 'y' ? node.top + node.translationY : key === 'z' ? node.elevation + node.translationZ : node[key];
  };
  const write = (runtime, a, value) => {
    if (a.animatorKind === 'cpFloat') { graphics(runtime).get(a.propHandle).value = value; return; }
    if (a.animatorKind === 'cpPaint') {
      const paint = graphics(runtime).get(a.propHandle).paint;
      if (a.paintField === 0) paint.strokeWidth = value; else { const alpha = Math.max(0, Math.min(255, Math.round(value))); paint.argb = ((alpha << 24) | (paint.argb & 0xffffff)) >>> 0; paint.alpha = alpha / 255; }
      return;
    }
    const node = platform.rtNodeState(runtime, a.target), key = NODE_PROPERTY[a.property];
    if (key === 'x') node.translationX = value - node.left; else if (key === 'y') node.translationY = value - node.top; else if (key === 'z') node.translationZ = value - node.elevation; else node[key] = key === 'alpha' ? Math.max(0, Math.min(1, value)) : value;
  };
  // ---- frame stepping ------------------------------------------------------------------------------------------------------------------------------------
  const finish = (runtime, a) => {
    a.state = 'finished'; running--;
    if (a.listenerRef) runtime.dispatch({ owner: ANIMATOR, name: 'callOnFinished', signature: `(${ANIMATOR})V`, parameters: [ANIMATOR], result: 'V' }, [a.listenerRef], 'static');
  };
  const live = id => { try { return get(id); } catch { animators.delete(id); return null; } };
  const step = (runtime, frameTimeMs) => {
    current = runtime; frameRequested = false;
    const done = [];
    for (const id of [...animators.keys()]) {
      const a = live(id); if (!a || a.state !== 'running') continue;
      if (a.startTime === null) { a.startTime = frameTimeMs; a.from = a.startValue ?? read(runtime, a); }
      const elapsed = frameTimeMs - a.startTime - a.delay; if (elapsed < 0) continue;
      const fraction = a.duration > 0 ? Math.min(1, elapsed / a.duration) : 1;
      write(runtime, a, fraction >= 1 ? a.finalValue : a.from + (a.finalValue - a.from) * a.interpolator(fraction));
      if (fraction >= 1) done.push(a);
    }
    for (const a of done) finish(runtime, a);
    if (running > 0) requestFrame(runtime);
    platform.redrawAll?.(runtime);   // property values changed: replay the recorded display lists
  };
  const requestFrame = runtime => { if (frameRequested || running <= 0) return; frameRequested = true; platform.viewWindowHost.planJsFrame(runtime, step); };
  const bindings = new Map(), add = (owner, name, p, result, fn) => bindings.set(`${owner}->${name}(${p.join('')})${result}`, (r, args) => { current = r; const a = args.map((v, i) => p[i] === 'F' ? decode(v) : v); return fn(r, a); });
  add(ANIMATOR, 'nCreateAnimator', ['I', 'F'], 'J', (r, [property, finalValue]) => { if (property < 0 || property >= NODE_PROPERTY.length) fail('Unknown RenderNode animator property ' + property); return create('node', { property, finalValue }); });
  add(ANIMATOR, 'nCreateCanvasPropertyFloatAnimator', ['J', 'F'], 'J', (r, [propHandle, finalValue]) => { graphics(r).get(propHandle); return create('cpFloat', { propHandle, finalValue }); });
  add(ANIMATOR, 'nCreateCanvasPropertyPaintAnimator', ['J', 'I', 'F'], 'J', (r, [propHandle, paintField, finalValue]) => { graphics(r).get(propHandle); if (paintField !== 0 && paintField !== 1) fail('Unknown CanvasProperty<Paint> field ' + paintField); return create('cpPaint', { propHandle, paintField, finalValue }); });
  add(ANIMATOR, 'nSetStartValue', ['J', 'F'], 'V', (r, [id, value]) => { get(id).startValue = value; });
  add(ANIMATOR, 'nSetDuration', ['J', 'J'], 'V', (r, [id, ms]) => { get(id).duration = Number(ms); });
  add(ANIMATOR, 'nGetDuration', ['J'], 'J', (r, [id]) => BigInt(get(id).duration));
  add(ANIMATOR, 'nSetStartDelay', ['J', 'J'], 'V', (r, [id, ms]) => { get(id).delay = Number(ms); });
  add(ANIMATOR, 'nSetInterpolator', ['J', 'J'], 'V', (r, [id, handle]) => { const fn = interpolators.get(BigInt(handle)); if (!fn) fail('Invalid native interpolator token'); get(id).interpolator = fn; });
  add(ANIMATOR, 'nSetAllowRunningAsync', ['J', 'Z'], 'V', (r, [id]) => { get(id); });
  add(ANIMATOR, 'nSetListener', ['J', ANIMATOR], 'V', (r, [id, listener]) => { current = r; get(id).listenerRef = listener; });
  add(ANIMATOR, 'nStart', ['J'], 'V', (r, [id]) => { const a = get(id); if (a.state !== 'prepare') return; a.state = 'running'; running++; requestFrame(r); });
  add(ANIMATOR, 'nEnd', ['J'], 'V', (r, [id]) => { const a = get(id); if (a.state === 'running') { write(r, a, a.finalValue); finish(r, a); platform.redrawAll?.(r); } });
  add(NODE, 'nAddAnimator', ['J', 'J'], 'V', (r, [node, id]) => { const a = get(id); platform.rtNodeState(r, node); a.target = node; });
  for (const name of ['nEndAllAnimators', 'nForceEndAnimators']) add(NODE, name, ['J'], 'V', (r, [node]) => { for (const id of [...animators.keys()]) { const a = live(id); if (a && a.target === node && a.state === 'running') { write(r, a, a.finalValue); finish(r, a); } } platform.redrawAll?.(r); });
  // native interpolators (NativeInterpolatorFactory)
  const fa = (name, p, result, fn) => add(FACTORY, name, p, result, fn);
  fa('createLinearInterpolator', [], 'J', () => newInterpolator(INTERPOLATORS.linear()));
  fa('createAccelerateDecelerateInterpolator', [], 'J', () => newInterpolator(INTERPOLATORS.accelerateDecelerate()));
  fa('createAccelerateInterpolator', ['F'], 'J', (r, [f]) => newInterpolator(INTERPOLATORS.accelerate(f)));
  fa('createDecelerateInterpolator', ['F'], 'J', (r, [f]) => newInterpolator(INTERPOLATORS.decelerate(f)));
  fa('createAnticipateInterpolator', ['F'], 'J', (r, [f]) => newInterpolator(INTERPOLATORS.anticipate(f)));
  fa('createAnticipateOvershootInterpolator', ['F'], 'J', (r, [f]) => newInterpolator(INTERPOLATORS.anticipateOvershoot(f)));
  fa('createOvershootInterpolator', ['F'], 'J', (r, [f]) => newInterpolator(INTERPOLATORS.overshoot(f)));
  fa('createBounceInterpolator', [], 'J', () => newInterpolator(INTERPOLATORS.bounce()));
  fa('createCycleInterpolator', ['F'], 'J', (r, [f]) => newInterpolator(INTERPOLATORS.cycle(f)));
  fa('createPathInterpolator', ['[F', '[F'], 'J', (r, [x, y]) => newInterpolator(INTERPOLATORS.path(r.array(x).elements.map(decode), r.array(y).elements.map(decode))));
  fa('createLutInterpolator', ['[F'], 'J', (r, [values]) => newInterpolator(INTERPOLATORS.lut(r.array(values).elements.map(decode))));
  // hwui's RenderPropertyAnimator keeps a global reference to the Java RenderNodeAnimator until it has finished: the animator tokens live in the graphics-handle table (not a GC
  // root), so their listeners are rooted here.
  const roots = visit => { if (current === null) return; for (const entry of graphics(current).handles.values()) if (entry.kind === 'rtAnimator' && entry.listenerRef) visit(entry.listenerRef); };
  return { bindings: [...bindings], table: bindings, runningCount: () => running, [GC_ROOTS]: roots };
}
