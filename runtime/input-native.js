import { APKError } from './apk-error.js?v=58b0147dafd8';
import { createHostRegistry } from './host-contract.js?v=58b0147dafd8';

// Natives behind the ORIGINAL android.view.MotionEvent, KeyEvent, KeyCharacterMap and VelocityTracker (android-13.0.0_r1 Java in framework.dex):
//   * MotionEvent  -- android_view_MotionEvent.cpp over libinput's MotionEvent: samples (current + history) of pointer coordinates per axis, pointer properties, an affine
//                     transform for getX()/getY() (offsetLocation / transform / scale), batching, copy and Parcel serialisation.
//   * VelocityTracker -- libinput's VelocityTracker "lsq2" strategy: a degree-2 least-squares fit over the last 100 ms of samples of each pointer.
//   * KeyEvent / KeyCharacterMap -- key code names and a generic US QWERTY layout (Generic.kcm semantics for letters, digits and punctuation) for getUnicodeChar/getEvents/...
// Everything lives in the VM's own memory; there is no input subsystem behind it. Real touches reach the app as MotionEvents built by the platform (see the Compose/View input
// hosts); here they are just faithful data carriers.
const MOTION = 'Landroid/view/MotionEvent;', COORDS = 'Landroid/view/MotionEvent$PointerCoords;', PROPS = 'Landroid/view/MotionEvent$PointerProperties;', MATRIX = 'Landroid/graphics/Matrix;', PARCEL = 'Landroid/os/Parcel;';
const VT = 'Landroid/view/VelocityTracker;', KEY = 'Landroid/view/KeyEvent;', KCM = 'Landroid/view/KeyCharacterMap;', STRING = 'Ljava/lang/String;';
const HISTORY_CURRENT = -0x80000000;
const AXIS_X = 0, AXIS_Y = 1, AXIS_PRESSURE = 2, AXIS_SIZE = 3, AXIS_TOUCH_MAJOR = 4, AXIS_TOUCH_MINOR = 5, AXIS_TOOL_MAJOR = 6, AXIS_TOOL_MINOR = 7, AXIS_ORIENTATION = 8, BASIC_AXES = 9, MAX_AXIS = 48;
const AXIS_NAMES = ['X', 'Y', 'PRESSURE', 'SIZE', 'TOUCH_MAJOR', 'TOUCH_MINOR', 'TOOL_MAJOR', 'TOOL_MINOR', 'ORIENTATION', 'VSCROLL', 'HSCROLL', 'Z', 'RX', 'RY', 'RZ', 'HAT_X', 'HAT_Y', 'LTRIGGER', 'RTRIGGER', 'THROTTLE', 'RUDDER', 'WHEEL', 'GAS', 'BRAKE', 'DISTANCE', 'TILT', 'SCROLL', 'RELATIVE_X', 'RELATIVE_Y', null, null, null, ...Array.from({ length: 16 }, (_, i) => `GENERIC_${i + 1}`)];
const ACTION_MASK = 0xff, ACTION_DOWN = 0, ACTION_UP = 1, ACTION_CANCEL = 3, ACTION_POINTER_DOWN = 5, ACTION_POINTER_UP = 6, ACTION_HOVER_MOVE = 7, ACTION_SCROLL = 8, ACTION_HOVER_ENTER = 9, ACTION_HOVER_EXIT = 10, ACTION_POINTER_INDEX_SHIFT = 8;
const SOURCE_CLASS_POINTER = 0x2;
const bitsView = new DataView(new ArrayBuffer(8));
const f2b = value => { bitsView.setFloat32(0, value, true); return bitsView.getInt32(0, true); };
const b2f = bits => { bitsView.setInt32(0, bits | 0, true); return bitsView.getFloat32(0, true); };
const states = new WeakMap();
const registryOf = runtime => states.get(runtime) ?? states.set(runtime, { events: new Map(), next: 0x5000_0000_0000n, trackers: new Map(), keymaps: new Map(), eventIds: 1 }).get(runtime);
const IDENTITY = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const multiply = (a, b) => { const r = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]; return r; };
const newEvent = () => ({ id: 0, deviceId: 0, source: 0, displayId: 0, action: 0, actionButton: 0, flags: 0, edgeFlags: 0, metaState: 0, buttonState: 0, classification: 0, xPrecision: 1, yPrecision: 1, xCursor: NaN, yCursor: NaN, downTime: 0n, transform: IDENTITY(), props: [], samples: [] });
const newCoords = () => ({ present: new Set([AXIS_X, AXIS_Y, AXIS_PRESSURE, AXIS_SIZE, AXIS_TOUCH_MAJOR, AXIS_TOUCH_MINOR, AXIS_TOOL_MAJOR, AXIS_TOOL_MINOR, AXIS_ORIENTATION]), values: new Float64Array(MAX_AXIS + 1) });

export function createInputNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  const M = (signature, callback) => add(MOTION, signature, callback);
  const event = (runtime, ptr) => { const e = registryOf(runtime).events.get(ptr); if (!e) throw new APKError('MotionEvent native pointer is not live (use after recycle)', { kind: 'motionevent-dead' }); return e; };
  const field = (runtime, ref, owner, name, type) => runtime.object(ref).fields.get(`${owner}->${name}:${type}`);
  const setField = (runtime, ref, owner, name, type, value) => runtime.storeField(runtime.object(ref).fields, `${owner}->${name}:${type}`, value);
  const sampleAt = (runtime, e, historyPos) => {
    const index = historyPos === HISTORY_CURRENT ? e.samples.length - 1 : historyPos;
    if (index < 0 || index >= e.samples.length) runtime.throwJava('Ljava/lang/IllegalArgumentException;', `historyPos(${historyPos}) must be in range [0, ${e.samples.length - 1}]`);
    return e.samples[index];
  };
  const pointerIndexCheck = (runtime, e, index) => { if (index < 0 || index >= e.props.length) runtime.throwJava('Ljava/lang/IllegalArgumentException;', `pointerIndex (${index}) out of range`); };
  /** Axis value as MotionEvent.getAxisValue reports it: X/Y go through the transform (getX/getY), orientation is rotated with it, the rest is stored data. */
  const axisValue = (e, sample, axis, pointerIndex, raw) => {
    const coords = sample.coords[pointerIndex], value = coords.values[axis];
    if (raw || (axis !== AXIS_X && axis !== AXIS_Y && axis !== AXIS_ORIENTATION)) return axis < 0 || axis > MAX_AXIS ? 0 : (coords.present.has(axis) ? value : 0);
    const m = e.transform, x = coords.values[AXIS_X], y = coords.values[AXIS_Y];
    if (axis === AXIS_X) return m[0] * x + m[1] * y + m[2];
    if (axis === AXIS_Y) return m[3] * x + m[4] * y + m[5];
    return value;   // orientation is stored data: only X/Y carry the touch-screen transform here
  };
  const readCoords = (runtime, ref) => {
    const c = newCoords();
    for (const [name, axis] of [['x', AXIS_X], ['y', AXIS_Y], ['pressure', AXIS_PRESSURE], ['size', AXIS_SIZE], ['touchMajor', AXIS_TOUCH_MAJOR], ['touchMinor', AXIS_TOUCH_MINOR], ['toolMajor', AXIS_TOOL_MAJOR], ['toolMinor', AXIS_TOOL_MINOR], ['orientation', AXIS_ORIENTATION]]) c.values[axis] = b2f(field(runtime, ref, COORDS, name, 'F') ?? 0);
    const bits = BigInt.asUintN(64, BigInt(field(runtime, ref, COORDS, 'mPackedAxisBits', 'J') ?? 0n)), packed = field(runtime, ref, COORDS, 'mPackedAxisValues', '[F');
    let index = 0; for (let axis = 0; axis <= 63; axis++) if ((bits >> BigInt(63 - axis)) & 1n) {   // PointerCoords packs axes MSB first: axis n is bit 63-n (BitSet64)
      if (axis <= MAX_AXIS && axis >= BASIC_AXES) { c.present.add(axis); c.values[axis] = b2f(runtime.object(packed).elements[index]); } index++; }
    return c;
  };
  const writeCoords = (runtime, ref, e, sample, pointerIndex) => {
    const coords = sample.coords[pointerIndex];
    for (const [name, axis] of [['x', AXIS_X], ['y', AXIS_Y], ['pressure', AXIS_PRESSURE], ['size', AXIS_SIZE], ['touchMajor', AXIS_TOUCH_MAJOR], ['touchMinor', AXIS_TOUCH_MINOR], ['toolMajor', AXIS_TOOL_MAJOR], ['toolMinor', AXIS_TOOL_MINOR], ['orientation', AXIS_ORIENTATION]]) setField(runtime, ref, COORDS, name, 'F', f2b(axisValue(e, sample, axis, pointerIndex, false)));
    let bits = 0n; const values = [];
    for (let axis = BASIC_AXES; axis <= MAX_AXIS; axis++) if (coords.present.has(axis)) { bits |= 1n << BigInt(63 - axis); values.push(f2b(coords.values[axis])); }
    setField(runtime, ref, COORDS, 'mPackedAxisBits', 'J', BigInt.asIntN(64, bits));
    const array = runtime.newArray('[F', Math.max(8, values.length)); runtime.object(array).elements = [...values, ...new Array(Math.max(8, values.length) - values.length).fill(0)];
    setField(runtime, ref, COORDS, 'mPackedAxisValues', '[F', array);
  };
  const matrixValues = (runtime, matrix) => { const array = runtime.newArray('[F', 9); runtime.dispatch({ owner: MATRIX, name: 'getValues', parameters: ['[F'], result: 'V', signature: '([F)V' }, [matrix, array], 'virtual'); return runtime.object(array).elements.map(b2f); };

  M('nativeInitialize(JIIIIIIIIIFFFFJJI[Landroid/view/MotionEvent$PointerProperties;[Landroid/view/MotionEvent$PointerCoords;)J', (runtime, [ptr, deviceId, source, displayId, action, flags, edgeFlags, metaState, buttonState, classification, xOffset, yOffset, xPrecision, yPrecision, downTime, eventTime, count, props, coords]) => {
    const r = registryOf(runtime), id = ptr === 0n ? r.next++ : ptr, e = newEvent(); r.events.set(id, e);
    if (count < 1 || count > 32) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'pointerCount must be at least 1 and at most 32');
    Object.assign(e, { id: r.eventIds++, deviceId, source, displayId, action, flags, edgeFlags, metaState, buttonState, classification, xPrecision: b2f(xPrecision), yPrecision: b2f(yPrecision), downTime: BigInt(downTime) });
    e.transform = [1, 0, b2f(xOffset), 0, 1, b2f(yOffset), 0, 0, 1];
    for (let i = 0; i < count; i++) e.props.push({ id: field(runtime, runtime.object(props).elements[i], PROPS, 'id', 'I') ?? 0, toolType: field(runtime, runtime.object(props).elements[i], PROPS, 'toolType', 'I') ?? 0 });
    const sample = { time: BigInt(eventTime), coords: [] };
    for (let i = 0; i < count; i++) { const c = readCoords(runtime, runtime.object(coords).elements[i]); c.values[AXIS_X] -= b2f(xOffset); c.values[AXIS_Y] -= b2f(yOffset); sample.coords.push(c); }
    e.samples.push(sample); return id;
  });
  M('nativeDispose(J)V', (runtime, [ptr]) => { registryOf(runtime).events.delete(ptr); });
  M('nativeAddBatch(JJ[Landroid/view/MotionEvent$PointerCoords;I)V', (runtime, [ptr, time, coords, metaState]) => {
    const e = event(runtime, ptr), sample = { time: BigInt(time), coords: [] };
    for (let i = 0; i < e.props.length; i++) { const c = readCoords(runtime, runtime.object(coords).elements[i]); c.values[AXIS_X] -= e.transform[2]; c.values[AXIS_Y] -= e.transform[5]; sample.coords.push(c); }   // raw = given - offset
    e.samples.push(sample); e.metaState |= metaState;
  });
  M('nativeGetPointerCoords(JIILandroid/view/MotionEvent$PointerCoords;)V', (runtime, [ptr, pointerIndex, historyPos, out]) => { const e = event(runtime, ptr); pointerIndexCheck(runtime, e, pointerIndex); writeCoords(runtime, out, e, sampleAt(runtime, e, historyPos), pointerIndex); });
  M('nativeGetPointerProperties(JILandroid/view/MotionEvent$PointerProperties;)V', (runtime, [ptr, pointerIndex, out]) => { const e = event(runtime, ptr); pointerIndexCheck(runtime, e, pointerIndex); setField(runtime, out, PROPS, 'id', 'I', e.props[pointerIndex].id); setField(runtime, out, PROPS, 'toolType', 'I', e.props[pointerIndex].toolType); });
  M('nativeAxisToString(I)Ljava/lang/String;', (runtime, [axis]) => AXIS_NAMES[axis] ?? null);
  M('nativeAxisFromString(Ljava/lang/String;)I', (runtime, [label]) => { const index = AXIS_NAMES.indexOf(runtime.stringCharacters(label)); return index; });
  M('nativeGetPointerId(JI)I', (runtime, [ptr, i]) => { const e = event(runtime, ptr); pointerIndexCheck(runtime, e, i); return e.props[i].id; });
  M('nativeGetToolType(JI)I', (runtime, [ptr, i]) => { const e = event(runtime, ptr); pointerIndexCheck(runtime, e, i); return e.props[i].toolType; });
  M('nativeGetEventTimeNanos(JI)J', (runtime, [ptr, historyPos]) => sampleAt(runtime, event(runtime, ptr), historyPos).time);
  M('nativeGetRawAxisValue(JIII)F', (runtime, [ptr, axis, i, historyPos]) => { const e = event(runtime, ptr); pointerIndexCheck(runtime, e, i); return f2b(axisValue(e, sampleAt(runtime, e, historyPos), axis, i, true)); });
  M('nativeGetAxisValue(JIII)F', (runtime, [ptr, axis, i, historyPos]) => { const e = event(runtime, ptr); pointerIndexCheck(runtime, e, i); return f2b(axisValue(e, sampleAt(runtime, e, historyPos), axis, i, false)); });
  M('nativeTransform(JLandroid/graphics/Matrix;)V', (runtime, [ptr, matrix]) => { const e = event(runtime, ptr); e.transform = multiply(matrixValues(runtime, matrix), e.transform); });
  M('nativeApplyTransform(JLandroid/graphics/Matrix;)V', (runtime, [ptr, matrix]) => { const e = event(runtime, ptr); e.transform = multiply(matrixValues(runtime, matrix), e.transform); });
  M('nativeCopy(JJZ)J', (runtime, [dest, source, keepHistory]) => {
    const r = registryOf(runtime), from = event(runtime, source), id = dest === 0n ? r.next++ : dest, copy = newEvent();
    Object.assign(copy, from, { transform: from.transform.slice(), props: from.props.map(p => ({ ...p })), samples: (keepHistory ? from.samples : from.samples.slice(-1)).map(s => ({ time: s.time, coords: s.coords.map(c => ({ present: new Set(c.present), values: Float64Array.from(c.values) })) })) });
    r.events.set(id, copy); return id;
  });
  const simple = (name, key, kind) => { M(`nativeGet${name}(J)${kind}`, (runtime, [ptr]) => event(runtime, ptr)[key]); };
  simple('Id', 'id', 'I'); simple('DeviceId', 'deviceId', 'I'); simple('Source', 'source', 'I'); simple('DisplayId', 'displayId', 'I'); simple('Action', 'action', 'I'); simple('Flags', 'flags', 'I'); simple('EdgeFlags', 'edgeFlags', 'I');
  simple('MetaState', 'metaState', 'I'); simple('ButtonState', 'buttonState', 'I'); simple('Classification', 'classification', 'I'); simple('ActionButton', 'actionButton', 'I'); simple('DownTimeNanos', 'downTime', 'J');
  for (const [name, key] of [['Source', 'source'], ['DisplayId', 'displayId'], ['Action', 'action'], ['Flags', 'flags'], ['EdgeFlags', 'edgeFlags'], ['ButtonState', 'buttonState'], ['ActionButton', 'actionButton']]) M(`nativeSet${name}(JI)V`, (runtime, [ptr, value]) => { event(runtime, ptr)[key] = value; });
  M('nativeSetDownTimeNanos(JJ)V', (runtime, [ptr, value]) => { event(runtime, ptr).downTime = BigInt(value); });
  M('nativeIsTouchEvent(J)Z', (runtime, [ptr]) => { const e = event(runtime, ptr); return (e.source & SOURCE_CLASS_POINTER) && ![ACTION_HOVER_MOVE, ACTION_HOVER_ENTER, ACTION_HOVER_EXIT, ACTION_SCROLL].includes(e.action & ACTION_MASK) ? 1 : 0; });
  M('nativeOffsetLocation(JFF)V', (runtime, [ptr, dx, dy]) => { const e = event(runtime, ptr); e.transform[2] += b2f(dx); e.transform[5] += b2f(dy); });
  M('nativeGetXOffset(J)F', (runtime, [ptr]) => f2b(event(runtime, ptr).transform[2])); M('nativeGetYOffset(J)F', (runtime, [ptr]) => f2b(event(runtime, ptr).transform[5]));
  M('nativeGetXPrecision(J)F', (runtime, [ptr]) => f2b(event(runtime, ptr).xPrecision)); M('nativeGetYPrecision(J)F', (runtime, [ptr]) => f2b(event(runtime, ptr).yPrecision));
  M('nativeGetXCursorPosition(J)F', (runtime, [ptr]) => f2b(event(runtime, ptr).xCursor)); M('nativeGetYCursorPosition(J)F', (runtime, [ptr]) => f2b(event(runtime, ptr).yCursor));
  M('nativeSetCursorPosition(JFF)V', (runtime, [ptr, x, y]) => { const e = event(runtime, ptr); e.xCursor = b2f(x); e.yCursor = b2f(y); });
  M('nativeGetPointerCount(J)I', (runtime, [ptr]) => event(runtime, ptr).props.length);
  M('nativeFindPointerIndex(JI)I', (runtime, [ptr, id]) => event(runtime, ptr).props.findIndex(p => p.id === id));
  M('nativeGetHistorySize(J)I', (runtime, [ptr]) => event(runtime, ptr).samples.length - 1);
  M('nativeGetSurfaceRotation(J)I', () => -1);
  M('nativeScale(JF)V', (runtime, [ptr, scale]) => {
    const e = event(runtime, ptr), s = b2f(scale);
    for (const sample of e.samples) for (const c of sample.coords) for (const axis of [AXIS_X, AXIS_Y, AXIS_TOUCH_MAJOR, AXIS_TOUCH_MINOR, AXIS_TOOL_MAJOR, AXIS_TOOL_MINOR]) c.values[axis] *= s;
    e.transform[2] *= s; e.transform[5] *= s; e.xPrecision *= s; e.yPrecision *= s;
  });
  // Parcel form: this VM's own layout (events never leave the process); every field round-trips, including history and the transform.
  const pcall = (runtime, parcel, name, parameters, result, args = []) => runtime.dispatch({ owner: PARCEL, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, args, { receiver: parcel }), 'virtual');
  M('nativeWriteToParcel(JLandroid/os/Parcel;)V', (runtime, [ptr, parcel]) => {
    const e = event(runtime, ptr), wi = v => pcall(runtime, parcel, 'writeInt', ['I'], 'V', [v | 0]), wl = v => pcall(runtime, parcel, 'writeLong', ['J'], 'V', [BigInt.asIntN(64, BigInt(v))]), wf = v => wi(f2b(v));
    for (const v of [e.id, e.deviceId, e.source, e.displayId, e.action, e.actionButton, e.flags, e.edgeFlags, e.metaState, e.buttonState, e.classification]) wi(v);
    wf(e.xPrecision); wf(e.yPrecision); wf(e.xCursor); wf(e.yCursor); wl(e.downTime); for (const v of e.transform) wf(v);
    wi(e.props.length); for (const p of e.props) { wi(p.id); wi(p.toolType); }
    wi(e.samples.length); for (const s of e.samples) { wl(s.time); for (const c of s.coords) { const axes = [...c.present].sort((a, b) => a - b); wi(axes.length); for (const axis of axes) { wi(axis); wf(c.values[axis]); } } }
  });
  M('nativeReadFromParcel(JLandroid/os/Parcel;)J', (runtime, [ptr, parcel]) => {
    const r = registryOf(runtime), ri = () => pcall(runtime, parcel, 'readInt', [], 'I'), rl = () => pcall(runtime, parcel, 'readLong', [], 'J'), rf = () => b2f(ri());
    const id = ptr === 0n ? r.next++ : ptr, e = newEvent();
    [e.id, e.deviceId, e.source, e.displayId, e.action, e.actionButton, e.flags, e.edgeFlags, e.metaState, e.buttonState, e.classification] = Array.from({ length: 11 }, ri);
    e.xPrecision = rf(); e.yPrecision = rf(); e.xCursor = rf(); e.yCursor = rf(); e.downTime = BigInt(rl()); e.transform = Array.from({ length: 9 }, rf);
    const count = ri(); if (count < 1 || count > 32) runtime.throwJava('Ljava/lang/RuntimeException;', 'Bad pointer count in MotionEvent parcel');
    for (let i = 0; i < count; i++) e.props.push({ id: ri(), toolType: ri() });
    const samples = ri(); for (let s = 0; s < samples; s++) { const sample = { time: BigInt(rl()), coords: [] }; for (let i = 0; i < count; i++) { const c = newCoords(); c.present.clear(); for (let a = ri(); a > 0; a--) { const axis = ri(); c.present.add(axis); c.values[axis] = rf(); } sample.coords.push(c); } e.samples.push(sample); }
    r.events.set(id, e); return id;
  });

  // ---- VelocityTracker (libinput lsq2)
  const HORIZON_MS = 100, STOPPED_MS = 40, DEGREE = 2, MAX_SAMPLES = 20;
  const tracker = (runtime, ptr) => { const t = registryOf(runtime).trackers.get(ptr); if (!t) throw new APKError('VelocityTracker native pointer is not live', { kind: 'velocitytracker-dead' }); return t; };
  /** Least-squares polynomial fit (QR by modified Gram-Schmidt); returns { coefficients, determination } or null when the fit is degenerate. */
  function fit(times, values, n) {
    const m = times.length, q = [], r = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const column = times.map(t => t ** j);
      for (let k = 0; k < j; k++) { const dot = q[k].reduce((s, v, i) => s + v * column[i], 0); r[k][j] = dot; for (let i = 0; i < m; i++) column[i] -= dot * q[k][i]; }
      const norm = Math.sqrt(column.reduce((s, v) => s + v * v, 0)); if (norm < 0.000001) return null;
      r[j][j] = norm; q.push(column.map(v => v / norm));
    }
    const qty = q.map(col => col.reduce((s, v, i) => s + v * values[i], 0)), coefficients = new Array(n).fill(0);
    for (let j = n - 1; j >= 0; j--) { let s = qty[j]; for (let k = j + 1; k < n; k++) s -= r[j][k] * coefficients[k]; coefficients[j] = s / r[j][j]; }
    const mean = values.reduce((s, v) => s + v, 0) / m; let err = 0, total = 0;
    for (let i = 0; i < m; i++) { let pred = 0; for (let j = 0; j < n; j++) pred += coefficients[j] * times[i] ** j; err += (values[i] - pred) ** 2; total += (values[i] - mean) ** 2; }
    return { coefficients, determination: total > 0.000001 ? 1 - err / total : 1 };
  }
  function estimate(samples) {
    if (!samples.length) return null;
    const newest = samples[samples.length - 1], xs = [], ys = [], ts = []; let previous = newest.time;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i], age = newest.time - s.time; if (age > HORIZON_MS) break; if (previous - s.time > STOPPED_MS) break;
      previous = s.time; xs.push(s.x); ys.push(s.y); ts.push(-age / 1000);
    }
    const m = xs.length; if (m === 0) return null;
    const degree = Math.min(m - 1, DEGREE); if (degree < 1) return { vx: 0, vy: 0, confidence: 1, degree: 0, xCoeff: [xs[0]], yCoeff: [ys[0]], time: newest.time };
    const fx = fit(ts, xs, degree + 1), fy = fit(ts, ys, degree + 1); if (!fx || !fy) return null;
    return { vx: fx.coefficients[1], vy: fy.coefficients[1], confidence: fx.determination * fy.determination, degree, xCoeff: fx.coefficients, yCoeff: fy.coefficients, time: newest.time };
  }
  add(VT, 'nativeInitialize(I)J', runtime => { const r = registryOf(runtime), id = r.next++; r.trackers.set(id, { pointers: new Map(), velocities: new Map() }); return id; });
  add(VT, 'nativeDispose(J)V', (runtime, [ptr]) => { registryOf(runtime).trackers.delete(ptr); });
  add(VT, 'nativeClear(J)V', (runtime, [ptr]) => { const t = tracker(runtime, ptr); t.pointers.clear(); t.velocities.clear(); t.active = undefined; });
  add(VT, 'nativeAddMovement(JLandroid/view/MotionEvent;)V', (runtime, [ptr, motion]) => {
    const t = tracker(runtime, ptr), nativePtr = BigInt.asIntN(64, BigInt(runtime.object(motion).fields.get(`${MOTION}->mNativePtr:J`) ?? 0n)), e = event(runtime, nativePtr), action = e.action & ACTION_MASK;
    if (action === ACTION_DOWN || action === ACTION_HOVER_ENTER) { t.pointers.clear(); t.velocities.clear(); t.active = e.props[0]?.id; }
    t.active ??= e.props[0]?.id;
    if (action === ACTION_POINTER_DOWN) { const index = (e.action >> ACTION_POINTER_INDEX_SHIFT) & 0xff; if (e.props[index]) t.pointers.delete(e.props[index].id); }
    const skip = action === ACTION_POINTER_UP ? e.props[(e.action >> ACTION_POINTER_INDEX_SHIFT) & 0xff]?.id : undefined;
    for (const sample of e.samples) for (let i = 0; i < e.props.length; i++) {
      const id = e.props[i].id; if (id === skip) continue;
      const list = t.pointers.get(id) ?? t.pointers.set(id, []).get(id), c = sample.coords[i];
      list.push({ time: Number(sample.time / 1_000_000n), x: c.values[AXIS_X], y: c.values[AXIS_Y] }); if (list.length > MAX_SAMPLES) list.shift();
    }
  });
  add(VT, 'nativeComputeCurrentVelocity(JIF)V', (runtime, [ptr, units, maxVelocity]) => {
    const t = tracker(runtime, ptr), max = b2f(maxVelocity); t.velocities.clear();
    for (const [id, samples] of t.pointers) {
      const result = estimate(samples); if (!result) continue;
      const clamp = v => { const scaled = v * (units / 1000); return max > 0 && Math.abs(scaled) > max ? Math.sign(scaled) * max : scaled; };
      t.velocities.set(id, { x: clamp(result.vx), y: clamp(result.vy), estimate: result });
    }
  });
  add(VT, 'nativeGetXVelocity(JI)F', (runtime, [ptr, id]) => { const t = tracker(runtime, ptr); return f2b(t.velocities.get(id === -1 ? t.active : id)?.x ?? 0); });
  add(VT, 'nativeGetYVelocity(JI)F', (runtime, [ptr, id]) => { const t = tracker(runtime, ptr); return f2b(t.velocities.get(id === -1 ? t.active : id)?.y ?? 0); });
  add(VT, 'nativeGetEstimator(JILandroid/view/VelocityTracker$Estimator;)Z', (runtime, [ptr, id, out]) => {
    const t = tracker(runtime, ptr), entry = t.velocities.get(id === -1 ? t.active : id); if (!entry) return 0;
    const e = entry.estimate, O = 'Landroid/view/VelocityTracker$Estimator;', coeff = values => { const array = runtime.newArray('[F', 5); runtime.object(array).elements = [...values.map(f2b), ...new Array(5 - values.length).fill(0)]; return array; };
    setField(runtime, out, O, 'xCoeff', '[F', coeff(e.xCoeff)); setField(runtime, out, O, 'yCoeff', '[F', coeff(e.yCoeff)); setField(runtime, out, O, 'degree', 'I', e.degree); setField(runtime, out, O, 'confidence', 'F', f2b(e.confidence)); return 1;
  });
  add(VT, 'nativeIsAxisSupported(II)Z', (runtime, [axis]) => axis === AXIS_X || axis === AXIS_Y ? 1 : 0);

  // ---- KeyEvent
  const KEYCODES = ['UNKNOWN', 'SOFT_LEFT', 'SOFT_RIGHT', 'HOME', 'BACK', 'CALL', 'ENDCALL', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'STAR', 'POUND', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'VOLUME_UP', 'VOLUME_DOWN', 'POWER', 'CAMERA', 'CLEAR',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'COMMA', 'PERIOD', 'ALT_LEFT', 'ALT_RIGHT', 'SHIFT_LEFT', 'SHIFT_RIGHT', 'TAB', 'SPACE', 'SYM', 'EXPLORER', 'ENVELOPE', 'ENTER', 'DEL', 'GRAVE', 'MINUS', 'EQUALS', 'LEFT_BRACKET', 'RIGHT_BRACKET', 'BACKSLASH', 'SEMICOLON', 'APOSTROPHE', 'SLASH', 'AT', 'NUM', 'HEADSETHOOK', 'FOCUS', 'PLUS', 'MENU', 'NOTIFICATION', 'SEARCH',
    'MEDIA_PLAY_PAUSE', 'MEDIA_STOP', 'MEDIA_NEXT', 'MEDIA_PREVIOUS', 'MEDIA_REWIND', 'MEDIA_FAST_FORWARD', 'MUTE', 'PAGE_UP', 'PAGE_DOWN', 'PICTSYMBOLS', 'SWITCH_CHARSET', 'BUTTON_A', 'BUTTON_B', 'BUTTON_C', 'BUTTON_X', 'BUTTON_Y', 'BUTTON_Z', 'BUTTON_L1', 'BUTTON_R1', 'BUTTON_L2', 'BUTTON_R2', 'BUTTON_THUMBL', 'BUTTON_THUMBR', 'BUTTON_START', 'BUTTON_SELECT', 'BUTTON_MODE',
    'ESCAPE', 'FORWARD_DEL', 'CTRL_LEFT', 'CTRL_RIGHT', 'CAPS_LOCK', 'SCROLL_LOCK', 'META_LEFT', 'META_RIGHT', 'FUNCTION', 'SYSRQ', 'BREAK', 'MOVE_HOME', 'MOVE_END', 'INSERT', 'FORWARD', 'MEDIA_PLAY', 'MEDIA_PAUSE', 'MEDIA_CLOSE', 'MEDIA_EJECT', 'MEDIA_RECORD',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'NUM_LOCK', ...Array.from({ length: 10 }, (_, i) => `NUMPAD_${i}`), 'NUMPAD_DIVIDE', 'NUMPAD_MULTIPLY', 'NUMPAD_SUBTRACT', 'NUMPAD_ADD', 'NUMPAD_DOT', 'NUMPAD_COMMA', 'NUMPAD_ENTER', 'NUMPAD_EQUALS', 'NUMPAD_LEFT_PAREN', 'NUMPAD_RIGHT_PAREN'];
  add(KEY, 'nativeKeyCodeToString(I)Ljava/lang/String;', (runtime, [code]) => KEYCODES[code] ?? null);
  add(KEY, 'nativeKeyCodeFromString(Ljava/lang/String;)I', (runtime, [label]) => { const i = KEYCODES.indexOf(runtime.stringCharacters(label)); return i < 0 ? 0 : i; });
  add(KEY, 'nativeNextId()I', runtime => registryOf(runtime).eventIds++);

  // ---- KeyCharacterMap: Generic.kcm for a US QWERTY keyboard (FULL = 4)
  const SHIFT_ON = 0x1, CAPS_ON = 0x100000;
  const charKeys = new Map();   // keyCode -> { base, shift }
  for (let i = 0; i < 26; i++) charKeys.set(29 + i, { base: String.fromCharCode(97 + i), shift: String.fromCharCode(65 + i), letter: true });
  const digitShift = ')!@#$%^&*(';
  for (let i = 0; i < 10; i++) charKeys.set(7 + i, { base: String(i), shift: digitShift[i] });
  for (const [code, base, shift] of [[55, ',', '<'], [56, '.', '>'], [62, ' ', ' '], [66, '\n', '\n'], [61, '\t', '\t'], [68, '`', '~'], [69, '-', '_'], [70, '=', '+'], [71, '[', '{'], [72, ']', '}'], [73, '\\', '|'], [74, ';', ':'], [75, "'", '"'], [76, '/', '?'], [77, '@', '@'], [81, '+', '+'], [17, '*', '*'], [18, '#', '#']]) charKeys.set(code, { base, shift });
  const charOf = (keyCode, metaState) => { const k = charKeys.get(keyCode); if (!k) return 0; const shifted = (metaState & SHIFT_ON) !== 0, caps = (metaState & CAPS_ON) !== 0; return (k.letter ? shifted !== caps : shifted) ? k.shift.charCodeAt(0) : k.base.charCodeAt(0); };
  const kcm = (runtime, ptr) => { const k = registryOf(runtime).keymaps.get(ptr); if (!k) throw new APKError('KeyCharacterMap native pointer is not live', { kind: 'keycharactermap-dead' }); return k; };
  add(KCM, 'nativeObtainEmptyKeyCharacterMap(I)Landroid/view/KeyCharacterMap;', (runtime, [deviceId]) => {
    const r = registryOf(runtime), id = r.next++; r.keymaps.set(id, { deviceId });
    const ref = runtime.allocate(KCM); runtime.dispatch({ owner: KCM, name: '<init>', parameters: ['J'], result: 'V', signature: '(J)V' }, runtime.argumentWords(['J'], [id], { receiver: ref }), 'direct'); return ref;
  });
  add(KCM, 'nativeDispose(J)V', (runtime, [ptr]) => { registryOf(runtime).keymaps.delete(ptr); });
  add(KCM, 'nativeEquals(JJ)Z', (runtime, [a, b]) => { kcm(runtime, a); kcm(runtime, b); return 1; });
  add(KCM, 'nativeGetCharacter(JII)C', (runtime, [ptr, keyCode, metaState]) => { kcm(runtime, ptr); return charOf(keyCode, metaState); });
  add(KCM, 'nativeGetNumber(JI)C', (runtime, [ptr, keyCode]) => { kcm(runtime, ptr); const k = charKeys.get(keyCode); return keyCode >= 7 && keyCode <= 16 ? k.base.charCodeAt(0) : keyCode === 17 || keyCode === 18 ? k.base.charCodeAt(0) : [81, 56].includes(keyCode) ? charKeys.get(keyCode).base.charCodeAt(0) : 0; });
  add(KCM, 'nativeGetDisplayLabel(JI)C', (runtime, [ptr, keyCode]) => { kcm(runtime, ptr); const k = charKeys.get(keyCode); return k ? (k.letter ? k.shift : k.base).charCodeAt(0) : 0; });
  add(KCM, 'nativeGetKeyboardType(J)I', (runtime, [ptr]) => { kcm(runtime, ptr); return 4; });
  add(KCM, 'nativeGetMatch(JI[CI)C', (runtime, [ptr, keyCode, chars, metaState]) => { kcm(runtime, ptr); const wanted = runtime.object(chars).elements; for (const meta of [metaState, metaState | SHIFT_ON]) { const c = charOf(keyCode, meta); if (c && wanted.includes(c)) return c; } return 0; });
  add(KCM, 'nativeGetFallbackAction(JIILandroid/view/KeyCharacterMap$FallbackAction;)Z', (runtime, [ptr]) => { kcm(runtime, ptr); return 0; });
  add(KCM, 'nativeGetEvents(J[C)[Landroid/view/KeyEvent;', (runtime, [ptr, chars]) => {
    kcm(runtime, ptr); const events = [], now = BigInt(Math.floor(runtime.platform.clock.now()));
    const make = (action, code, meta) => { const e = runtime.allocate(KEY); const parameters = ['J', 'J', 'I', 'I', 'I', 'I', 'I', 'I']; runtime.dispatch({ owner: KEY, name: '<init>', parameters, result: 'V', signature: '(JJIIIIII)V' }, runtime.argumentWords(parameters, [now, now, action, code, 0, meta, -1, 0], { receiver: e }), 'direct'); return e; };
    for (const unit of runtime.object(chars).elements) {
      const ch = String.fromCharCode(unit); let entry = null;
      for (const [code, k] of charKeys) { if (k.base === ch) { entry = { code, meta: 0 }; break; } if (k.shift === ch && !entry) entry = { code, meta: SHIFT_ON | 0x40 }; }
      if (!entry) return null;
      if (entry.meta) events.push(make(0, 59, 0x41)); events.push(make(0, entry.code, entry.meta)); events.push(make(1, entry.code, entry.meta)); if (entry.meta) events.push(make(1, 59, 0));
    }
    const array = runtime.newArray('[Landroid/view/KeyEvent;', events.length); runtime.object(array).elements = events; return array;
  });
  add(KCM, 'nativeReadFromParcel(Landroid/os/Parcel;)J', runtime => { const r = registryOf(runtime), id = r.next++; r.keymaps.set(id, { deviceId: 0 }); return id; });
  add(KCM, 'nativeWriteToParcel(JLandroid/os/Parcel;)V', (runtime, [ptr]) => { kcm(runtime, ptr); });
  return bindings;
}

/** Host side of the input stack: the InputManager singleton and the one virtual keyboard InputDevice that KeyCharacterMap.load / KeyEvent.getDevice reach. */
export function createInputManagerHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const MANAGER = 'Landroid/hardware/input/InputManager;', DEVICE = 'Landroid/view/InputDevice;';
  type(MANAGER, 'Ljava/lang/Object;', [], { allocatable: true }); type(DEVICE, 'Ljava/lang/Object;', [], { allocatable: true });
  const state = new WeakMap();
  const slot = r => state.get(r) ?? state.set(r, { manager: null, device: null, map: null }).get(r);
  const device = r => { const s = slot(r); if (!s.device) { s.device = r.makeObject(DEVICE); r.object(s.device).deviceId = -1; } return s.device; };
  def(MANAGER, 'getInstance', `()${MANAGER}`, r => { const s = slot(r); return s.manager ??= r.makeObject(MANAGER); }, { static: true });
  def(MANAGER, 'getInputDevice', `(I)${DEVICE}`, (r, _m, [, id]) => id === -1 ? device(r) : null);       // only the virtual keyboard (-1) exists
  def(MANAGER, 'getInputDeviceIds', '()[I', r => { const a = r.newArray('[I', 1); r.object(a).elements = [-1]; return a; });
  def(MANAGER, 'deviceHasKeys', '([I)[Z', (r, _m, [, codes]) => { const n = r.object(codes).elements.length, a = r.newArray('[Z', n); r.object(a).elements = r.object(codes).elements.map(code => (code >= 7 && code <= 16) || (code >= 29 && code <= 54) || [4, 19, 20, 21, 22, 23, 61, 62, 66, 67, 55, 56, 59, 60, 111].includes(code) ? 1 : 0); return a; });
  def(DEVICE, 'getDevice', `(I)${DEVICE}`, (r, _m, [id]) => id === -1 ? device(r) : null, { static: true });
  def(DEVICE, 'getDeviceIds', '()[I', r => { const a = r.newArray('[I', 1); r.object(a).elements = [-1]; return a; }, { static: true });
  def(DEVICE, 'getId', '()I', () => -1); def(DEVICE, 'getName', `()${STRING}`, () => 'Virtual'); def(DEVICE, 'isVirtual', '()Z', () => 1); def(DEVICE, 'getSources', '()I', () => 0x101);
  def(DEVICE, 'getKeyboardType', '()I', () => 2);
  def(DEVICE, 'getKeyCharacterMap', `()${KCM}`, r => { const s = slot(r); return s.map ??= r.dispatch({ owner: KCM, name: 'nativeObtainEmptyKeyCharacterMap', parameters: ['I'], result: KCM, signature: `(I)${KCM}` }, [-1], 'static'); });
  return { ...registry };
}
