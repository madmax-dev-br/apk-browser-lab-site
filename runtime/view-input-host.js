import { APKError } from './apk-runtime.js?v=33d211b8a989';
import { gcRoot } from './heap-gc.js?v=33d211b8a989';

const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;';
const SUPER_ERROR = 'Landroid/util/SuperNotCalledException;';
const numbers = new DataView(new ArrayBuffer(4));
const decode = value => { numbers.setInt32(0, value, true); return numbers.getFloat32(0, true); };
const encode = value => { numbers.setFloat32(0, value, true); return numbers.getInt32(0, true); };
const same = (left, right) => left?.ref !== undefined && left.ref === right?.ref;
const keys = new Set(['getAlpha()F', 'setAlpha(F)V', 'onSetAlpha(I)Z', 'getTransitionAlpha()F', 'setTransitionAlpha(F)V', 'setOnDragListener(Landroid/view/View$OnDragListener;)V',
  'isScrollContainer()Z', 'setScrollContainer(Z)V', 'getOverScrollMode()I', 'setOverScrollMode(I)V', 'setDefaultFocusHighlightEnabled(Z)V', 'getDefaultFocusHighlightEnabled()Z', 'cancelPendingInputEvents()V',
  'dispatchCancelPendingInputEvents()V', 'onCancelPendingInputEvents()V', 'cancelLongPress()V'].map(signature => VIEW + '->' + signature));
for (const signature of ['isClickable()Z', 'setClickable(Z)V', 'isLongClickable()Z', 'setLongClickable(Z)V', 'hasOnClickListeners()Z']) keys.add(VIEW + '->' + signature);
keys.add(GROUP + '->dispatchCancelPendingInputEvents()V');

/** View state at the web rendering/input boundary. Contracts follow the pinned
 * AOSP View/ViewGroup sources; this is not a port of their entire render tree.
 * Browser click messages are synchronous. Only queued high-level input bearing
 * viewInput metadata is removed; arbitrary View.post/Handler work is preserved.
 */
export function createViewInputHost(platform) {
  const registeredScrollContainers = gcRoot(new Set()), cancellationStack = gcRoot([]);
  const dispatch = (runtime, receiver, name, parameters = [], result = 'V', values = []) => runtime.dispatch(
    { owner: VIEW, name, parameters, result, signature: `(${parameters.join('')})${result}` },
    runtime.argumentWords(parameters, values, { receiver }), 'virtual');
  const cancelQueued = (receiver, kinds) => {
    platform.eventQueue = platform.eventQueue.filter(event => !same(event.viewInput?.receiver, receiver) || !kinds.includes(event.viewInput.kind));
  };
  const cancel = (runtime, receiver, seen = new Set()) => {
    if (seen.has(receiver.ref) || seen.size >= 4096 || cancellationStack.length >= 64) throw new APKError('Cyclic/excessive View input cancellation', { kind: 'view-input-unsupported' });
    seen.add(receiver.ref);
    const state = { receiver, calledSuper: false }; cancellationStack.push(state);
    try {
      dispatch(runtime, receiver, 'onCancelPendingInputEvents');
      if (!state.calledSuper) runtime.throwJava(SUPER_ERROR, 'View ' + runtime.object(receiver).type + ' did not call through to super.onCancelPendingInputEvents()');
    } finally { cancellationStack.pop(); }
    const view = runtime.object(receiver);
    if (runtime.isSubtype(view.type, GROUP)) for (const child of [...(view.children || [])]) cancel(runtime, child, seen);
  };
  return {
    supports: key => keys.has(key),
    parent: type => type === SUPER_ERROR ? 'Ljava/lang/RuntimeException;' : null,
    afterAttach(runtime, receiver, attached) {
      if (attached && runtime.object(receiver).scrollContainerRequested) registeredScrollContainers.add(receiver.ref);
      else registeredScrollContainers.delete(receiver.ref);
    },
    invoke(runtime, method, args) {
      const receiver = args[0], view = runtime.object(receiver), name = method.name;
      if (name === 'isClickable') return (view.clickable ?? (!!view.listener || runtime.isSubtype(view.type, 'Landroid/widget/Button;') || runtime.isSubtype(view.type, 'Landroid/widget/EditText;'))) ? 1 : 0;
      if (name === 'isLongClickable') return (view.longClickable ?? runtime.isSubtype(view.type, 'Landroid/widget/EditText;')) ? 1 : 0;
      if (name === 'hasOnClickListeners') return view.listener ? 1 : 0;
      if (name === 'setClickable' || name === 'setLongClickable') {
        const field = name === 'setClickable' ? 'clickable' : 'longClickable', mask = name === 'setClickable' ? 0x4000 : 0x200000;
        view[field] = !!args[1];
        const key = `${VIEW}->mViewFlags:I`, flags = view.fields.get(key) ?? 0;
        runtime.storeField(view.fields, key, args[1] ? flags | mask : flags & ~mask);
        platform.requestDraw(runtime, receiver); return;
      }
      if (name === 'getAlpha') return encode(view.alpha ?? 1);
      if (name === 'getTransitionAlpha') return encode(view.transitionAlpha ?? 1);
      if (name === 'onSetAlpha') return 0;
      // Registration is real state; DragEvent dispatch remains unsupported until
      // the browser drag payload and Android permissions have an explicit bridge.
      if (name === 'setOnDragListener') { if (args[1]) runtime.object(args[1]); view.dragListener = args[1] || null; return; }
      if (name === 'setAlpha' || name === 'setTransitionAlpha') {
        const alpha = decode(args[1]), field = name === 'setAlpha' ? 'alpha' : 'transitionAlpha';
        if (!Number.isFinite(alpha)) throw new APKError('Non-finite View alpha is unsupported by the web renderer', { kind: 'view-input-unsupported' });
        if ((view[field] ?? 1) === alpha) return;
        view[field] = alpha;
        view.alphaHandledByView = name === 'setAlpha' && !!dispatch(runtime, receiver, 'onSetAlpha', ['I'], 'Z', [Math.max(-2147483648, Math.min(2147483647, Math.trunc(Math.fround(alpha * 255))))]);
        view.renderAlpha = view.alphaHandledByView ? 1 : Math.fround((view.alpha ?? 1) * (view.transitionAlpha ?? 1));
        platform.requestDraw(runtime, receiver);
        return;
      }
      if (name === 'setScrollContainer') {
        view.scrollContainerRequested = !!args[1];
        this.afterAttach(runtime, receiver, !!view.attached);
        return;
      }
      if (name === 'isScrollContainer') return registeredScrollContainers.has(receiver.ref) ? 1 : 0;
      if (name === 'getOverScrollMode') return view.overScrollMode ?? 0;
      if (name === 'getDefaultFocusHighlightEnabled') return view.defaultFocusHighlightEnabled === false ? 0 : 1;
      if (name === 'setDefaultFocusHighlightEnabled') { view.defaultFocusHighlightEnabled = !!args[1]; return; }
      if (name === 'setOverScrollMode') {
        if (![0, 1, 2].includes(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid overscroll mode ' + args[1]);
        view.overScrollMode = args[1]; return;
      }
      if (name === 'cancelPendingInputEvents' || name === 'dispatchCancelPendingInputEvents') return cancel(runtime, receiver);
      if (name === 'cancelLongPress') { cancelQueued(receiver, ['longPress', 'tap']); return; }
      if (name === 'onCancelPendingInputEvents') {
        cancelQueued(receiver, ['click']);
        dispatch(runtime, receiver, 'cancelLongPress');
        const current = cancellationStack.at(-1);
        if (current && same(current.receiver, receiver)) current.calledSuper = true;
        return;
      }
      throw new APKError('Unsupported View input operation: ' + name, { kind: 'view-input-unsupported' });
    },
  };
}
