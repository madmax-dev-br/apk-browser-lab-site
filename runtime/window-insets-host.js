import { APKError } from './apk-runtime.js?v=cfd2299f1410';
import { gcRoot } from './heap-gc.js?v=cfd2299f1410';

const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', INSETS = 'Landroid/view/WindowInsets;', RECT = 'Landroid/graphics/Rect;';
const LISTENER = 'Landroid/view/View$OnApplyWindowInsetsListener;';
const ROOT_IMPL = 'Landroid/view/ViewRootImpl;', ATTACH_INFO = 'Landroid/view/View$AttachInfo;';
const keys = new Set();
for (const signature of [
  `setOnApplyWindowInsetsListener(${LISTENER})V`, `onApplyWindowInsets(${INSETS})${INSETS}`,
  `dispatchApplyWindowInsets(${INSETS})${INSETS}`, `getRootWindowInsets()${INSETS}`,
  'requestApplyInsets()V', 'requestFitSystemWindows()V', 'setFitsSystemWindows(Z)V',
  'getFitsSystemWindows()Z', 'fitsSystemWindows()Z', `fitSystemWindows(${RECT})Z`,
  `computeFitSystemWindows(${RECT}${RECT})Z`, `computeSystemWindowInsets(${INSETS}${RECT})${INSETS}`,
  'makeOptionalFitsSystemWindows()V', 'makeFrameworkOptionalFitsSystemWindows()V', 'isFrameworkOptionalFitsSystemWindows()Z',
]) keys.add(VIEW + '->' + signature);
keys.add(`${VIEW}->getViewRootImpl()${ROOT_IMPL}`);
keys.add(GROUP + `->dispatchApplyWindowInsets(${INSETS})${INSETS}`);
const call = (runtime, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => runtime.dispatch(
  { owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);
const fail = message => { throw new APKError(message, { kind: 'window-insets-unsupported' }); };

/** View/window event boundary. WindowInsets values, consumption, copies and type masks
 * execute the original AOSP Java. The browser device's content viewport has no Android
 * status/navigation bars or display cutout; its real source objects therefore start at zero.
 */
export function createWindowInsetsHost(platform) {
  const roots = gcRoot(new Map()), scheduled = new Set();
  const windows = gcRoot(new Map());
  const rootOf = (runtime, receiver) => {
    const seen = new Set(); let current = receiver;
    while (runtime.object(current).parent) {
      if (seen.has(current.ref) || seen.size >= 4096) fail('Cyclic/excessive window-insets hierarchy');
      seen.add(current.ref); current = runtime.object(current).parent;
    }
    return current;
  };
  const attached = (runtime, receiver) => !!call(runtime, receiver, VIEW, 'isAttachedToWindow', [], 'Z');
  const newRect = runtime => {
    const result = runtime.allocate(RECT); call(runtime, result, RECT, '<init>', [], 'V', [], 'direct'); return result;
  };
  const fromRect = (runtime, rect) => {
    if (!runtime.classes.has(INSETS)) throw new APKError('WindowInsets requires the source-compiled AOSP boot layer', { kind: 'framework-source-required', className: INSETS });
    const result = runtime.allocate(INSETS); call(runtime, result, INSETS, '<init>', [RECT], 'V', [rect], 'direct'); return result;
  };
  // Activity roots receive the virtual device's system-bar insets (system-bars-host); other roots (dialog windows) and unconfigured runtimes get zero insets.
  const initial = (runtime, root) => {
    const source = platform.systemBarsHost?.insetsFor?.(runtime, root), cached = roots.get(root.ref);
    if (cached && (!source || cached.key === source.key)) return cached.insets;
    const built = source?.build?.() ?? fromRect(runtime, newRect(runtime));
    roots.set(root.ref, { key: source?.key ?? null, insets: built }); return built;
  };
  const rectangle = (runtime, insets) => call(runtime, insets, INSETS, 'getSystemWindowInsetsAsRect', [], RECT);
  const copyRect = (runtime, target, source) => call(runtime, target, RECT, 'set', [RECT], 'V', [source]);
  const consume = (runtime, value) => call(runtime, value, INSETS, 'consumeSystemWindowInsets', [], INSETS);
  const attachment = (runtime, receiver) => {
    if (!attached(runtime, receiver)) return null;
    const token = call(runtime, receiver, VIEW, 'getWindowToken', [], 'Landroid/os/IBinder;');
    if (!token) fail('Attached View has no virtual window token');
    if (!windows.has(token.ref)) {
      const info = runtime.makeObject(ATTACH_INFO), root = runtime.makeObject(ROOT_IMPL), source = initial(runtime, rootOf(runtime, receiver));
      runtime.storeField(runtime.object(root).fields, `${ROOT_IMPL}->mAttachInfo:${ATTACH_INFO}`, info);
      runtime.storeField(runtime.object(info).fields, `${ATTACH_INFO}->mViewRootImpl:${ROOT_IMPL}`, root);
      for (const name of ['mContentInsets', 'mVisibleInsets', 'mStableInsets']) {
        const rect = newRect(runtime);
        if (name === 'mContentInsets') copyRect(runtime, rect, rectangle(runtime, source));
        if (name === 'mStableInsets') call(runtime, rect, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', ['Left', 'Top', 'Right', 'Bottom'].map(side => call(runtime, source, INSETS, 'getStableInset' + side, [], 'I')));
        runtime.storeField(runtime.object(info).fields, `${ATTACH_INFO}->${name}:${RECT}`, rect);
      }
      windows.set(token.ref, { info, root });
    }
    const { info } = windows.get(token.ref);
    runtime.storeField(runtime.object(receiver).fields, `${VIEW}->mAttachInfo:${ATTACH_INFO}`, info);
    return info;
  };
  const applyPadding = (runtime, receiver, rect) => {
    const fields = runtime.object(rect).fields;
    const values = ['left', 'top', 'right', 'bottom'].map(side => fields.get(`${RECT}->${side}:I`) ?? 0);
    call(runtime, receiver, VIEW, 'setPadding', ['I', 'I', 'I', 'I'], 'V', values);
  };
  const compute = (runtime, receiver, insets, local) => {
    const view = runtime.object(receiver);
    // The web window has no framework OnContentApplyWindowInsetsListener. Optional
    // fitting delegates responsibility to the app, as View.computeSystemWindowInsets does.
    if ((view.optionalFitsSystemWindows || view.frameworkOptionalFitsSystemWindows) && attached(runtime, receiver)) {
      call(runtime, local, RECT, 'setEmpty'); return insets;
    }
    copyRect(runtime, local, rectangle(runtime, insets));
    return call(runtime, consume(runtime, insets), INSETS, 'inset', [RECT], INSETS, [local]);
  };
  const schedule = (runtime, receiver) => {
    const root = rootOf(runtime, receiver);
    if (!attached(runtime, receiver) || scheduled.has(root.ref)) return;
    scheduled.add(root.ref);
    platform.queueTask(() => {
      scheduled.delete(root.ref);
      if (!attached(runtime, root)) return;
      runtime.record('WINDOW insets dispatch [web content viewport; original AOSP WindowInsets]');
      call(runtime, root, VIEW, 'dispatchApplyWindowInsets', [INSETS], INSETS, [initial(runtime, root)]);
    }, 0, [root]);
  };
  const dispatchSelf = (runtime, receiver, insets) => {
    runtime.object(insets);
    const listener = runtime.object(receiver).windowInsetsListener;
    const result = listener ? call(runtime, listener, LISTENER, 'onApplyWindowInsets', [VIEW, INSETS], INSETS, [receiver, insets])
      : call(runtime, receiver, VIEW, 'onApplyWindowInsets', [INSETS], INSETS, [insets]);
    if (!result) runtime.throwJava('Ljava/lang/NullPointerException;', 'Window-insets callback returned null');
    return result;
  };
  return {
    supports: key => keys.has(key),
    parent: type => [ROOT_IMPL, ATTACH_INFO].includes(type) ? 'Ljava/lang/Object;' : null,
    interfaces: type => type === ROOT_IMPL ? ['Landroid/view/ViewParent;'] : [],
    // A bounded declaration table for these existing Android members. Unknown
    // members remain unknown; it does not claim the complete class metadata.
    reflectionDefinition(owner, kind, name, parameters, publicOnly) {
      if (owner === VIEW && kind === 'method' && name === 'getViewRootImpl' && parameters.length === 0) {
        const signature = `()${ROOT_IMPL}`;
        return { method: { owner, name, parameters: [], result: ROOT_IMPL, signature, key: `${owner}->${name}${signature}` }, flags: 1 };
      }
      if (kind !== 'field' || publicOnly) return null;
      const type = owner === VIEW && name === 'mAttachInfo' || owner === ROOT_IMPL && name === 'mAttachInfo' ? ATTACH_INFO
        : owner === ATTACH_INFO && name === 'mViewRootImpl' ? ROOT_IMPL
        : owner === ATTACH_INFO && ['mContentInsets', 'mVisibleInsets', 'mStableInsets'].includes(name) ? RECT : null;
      return type ? { field: { owner, name, type, key: `${owner}->${name}:${type}` }, flags: owner === VIEW ? 0 : 0x10 } : null;
    },
    afterAttach(runtime, receiver, isAttached) {
      if (isAttached && runtime.classes.has(INSETS)) { attachment(runtime, receiver); schedule(runtime, receiver); }
      else if (!isAttached) {
        runtime.storeField(runtime.object(receiver).fields, `${VIEW}->mAttachInfo:${ATTACH_INFO}`, null);
        const root = rootOf(runtime, receiver); if (root.ref === receiver.ref) roots.delete(root.ref);
      }
    },
    /** The root's window insets changed (system bars shown/hidden/resized): rebuild and re-dispatch through the hierarchy. */
    invalidate(runtime, root) { roots.delete(root.ref); if (attached(runtime, root)) schedule(runtime, root); },
    invoke(runtime, method, args) {
      const receiver = args[0], view = runtime.object(receiver), name = method.name;
      if (name === 'getViewRootImpl') {
        const key = `${VIEW}->mAttachInfo:${ATTACH_INFO}`, info = view.fields.has(key) ? view.fields.get(key) : attachment(runtime, receiver);
        return info ? runtime.object(info).fields.get(`${ATTACH_INFO}->mViewRootImpl:${ROOT_IMPL}`) : null;
      }
      if (name === 'setOnApplyWindowInsetsListener') { view.windowInsetsListener = args[1] || null; return; }
      if (name === 'requestApplyInsets' || name === 'requestFitSystemWindows') return schedule(runtime, receiver);
      if (name === 'getRootWindowInsets') return attached(runtime, receiver) ? initial(runtime, rootOf(runtime, receiver)) : null;
      if (name === 'setFitsSystemWindows') { view.fitsSystemWindows = !!args[1]; return; }
      if (name === 'getFitsSystemWindows' || name === 'fitsSystemWindows') return view.fitsSystemWindows ? 1 : 0;
      if (name === 'makeOptionalFitsSystemWindows') { view.optionalFitsSystemWindows = true; return; }
      if (name === 'makeFrameworkOptionalFitsSystemWindows') { view.frameworkOptionalFitsSystemWindows = true; return; }
      if (name === 'isFrameworkOptionalFitsSystemWindows') return view.frameworkOptionalFitsSystemWindows ? 1 : 0;
      if (name === 'computeSystemWindowInsets') return compute(runtime, receiver, args[1], args[2]);
      if (name === 'computeFitSystemWindows') {
        const inner = compute(runtime, receiver, fromRect(runtime, args[1]), args[2]);
        copyRect(runtime, args[1], rectangle(runtime, inner));
        return call(runtime, inner, INSETS, 'isSystemWindowInsetsConsumed', [], 'Z');
      }
      if (name === 'fitSystemWindows') {
        if (!view.fitsSystemWindows) return 0;
        const local = newRect(runtime), consumed = call(runtime, receiver, VIEW, 'computeFitSystemWindows', [RECT, RECT], 'Z', [args[1], local]);
        applyPadding(runtime, receiver, local); return consumed;
      }
      if (name === 'onApplyWindowInsets') {
        if (view.frameworkOptionalFitsSystemWindows && view.fitsSystemWindows) {
          const local = newRect(runtime), result = compute(runtime, receiver, args[1], local); applyPadding(runtime, receiver, local); return result;
        }
        return call(runtime, receiver, VIEW, 'fitSystemWindows', [RECT], 'Z', [rectangle(runtime, args[1])]) ? consume(runtime, args[1]) : args[1];
      }
      if (name === 'dispatchApplyWindowInsets') {
        let result = dispatchSelf(runtime, receiver, args[1]);
        // The virtual device advertises API28: consumed results propagate sequentially
        // to siblings, matching pre-R ViewGroup dispatch compatibility semantics.
        if (method.owner === GROUP) for (const child of [...(view.children || [])]) {
          if (call(runtime, result, INSETS, 'isConsumed', [], 'Z')) break;
          result = call(runtime, child, VIEW, name, [INSETS], INSETS, [result]);
        }
        return result;
      }
      fail('Unsupported window-insets operation ' + name);
    },
  };
}
