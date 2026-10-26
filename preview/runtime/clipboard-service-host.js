import { APKError } from './apk-runtime.js?v=5db7b8182013';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=5db7b8182013';
const MANAGER = 'Landroid/content/ClipboardManager;', LEGACY = 'Landroid/text/ClipboardManager;';
const CLIP = 'Landroid/content/ClipData;', ITEM = 'Landroid/content/ClipData$Item;', DESCRIPTION = 'Landroid/content/ClipDescription;';
const LISTENER = 'Landroid/content/ClipboardManager$OnPrimaryClipChangedListener;';
const keys = new Set([
  `setPrimaryClip(${CLIP})V`, `getPrimaryClip()${CLIP}`, `getPrimaryClipDescription()${DESCRIPTION}`, 'hasPrimaryClip()Z', 'clearPrimaryClip()V',
  `addPrimaryClipChangedListener(${LISTENER})V`, `removePrimaryClipChangedListener(${LISTENER})V`,
  'getText()Ljava/lang/CharSequence;', 'setText(Ljava/lang/CharSequence;)V', 'hasText()Z',
].map(signature => `${MANAGER}->${signature}`));
for (const signature of ['getText()Ljava/lang/CharSequence;', 'setText(Ljava/lang/CharSequence;)V', 'hasText()Z']) keys.add(`${LEGACY}->${signature}`);
const call = (runtime, receiver, owner, name, parameters, result, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, values, mode === 'static' ? {} : { receiver }), mode);

/** The virtual device's clipboard. ClipData/ClipDescription algorithms execute
 * their original AOSP DEX; the Binder storage endpoint is this VM's memory.
 * The browser/OS clipboard is intentionally a separate device and is never read
 * while an APK launches. URI grants, Intent transport and cross-app Binder are
 * not implemented. Listener delivery runs APK bytecode on the VM event queue.
 */
export function createClipboardServiceHost(platform) {
  let manager = null, primary = null;
  const listeners = gcRoot([]);
  const copy = (runtime, clip) => {
    if (!runtime.classes.has(CLIP)) throw new APKError('Original AOSP ClipData DEX required');
    const description = runtime.allocate(DESCRIPTION), source = call(runtime, clip, CLIP, 'getDescription', [], DESCRIPTION);
    call(runtime, description, DESCRIPTION, '<init>', [DESCRIPTION], 'V', [source], 'direct');
    const value = runtime.allocate(CLIP), count = call(runtime, clip, CLIP, 'getItemCount', [], 'I');
    for (let i = 0; i < count; i++) {
      const item = runtime.allocate(ITEM), original = call(runtime, clip, CLIP, 'getItemAt', ['I'], ITEM, [i]);
      call(runtime, item, ITEM, '<init>', [ITEM], 'V', [original], 'direct');
      if (i === 0) call(runtime, value, CLIP, '<init>', [DESCRIPTION, ITEM], 'V', [description, item], 'direct');
      else call(runtime, value, CLIP, 'addItem', [ITEM], 'V', [item]);
    }
    return value;
  };
  const notify = runtime => {
    if (!listeners.length) return;
    platform.queueTask(() => {
      // Android's main-thread reportPrimaryClipChanged takes the snapshot when
      // delivering, preserving duplicates and first-occurrence removal.
      for (const listener of [...listeners]) call(runtime, listener, LISTENER, 'onPrimaryClipChanged', [], 'V');
    }, 0, []);   // the listeners are read from the registered list when the task runs
  };
  const setClip = (runtime, clip) => {
    if (!clip) runtime.throwJava('Ljava/lang/NullPointerException;', 'clip is null');
    const count = call(runtime, clip, CLIP, 'getItemCount', [], 'I');
    if (count < 1 || count > 4096) throw new APKError('Virtual clipboard requires 1–4096 items');
    const sourceDescription = call(runtime, clip, CLIP, 'getDescription', [], DESCRIPTION);
    const label = call(runtime, sourceDescription, DESCRIPTION, 'getLabel', [], 'Ljava/lang/CharSequence;');
    if (label != null && typeof label !== 'string') throw new APKError('Virtual clipboard transport currently requires an immutable String label');
    if (call(runtime, sourceDescription, DESCRIPTION, 'getExtras', [], 'Landroid/os/PersistableBundle;')) throw new APKError('Virtual clipboard parcelled extras are not implemented');
    for (let i = 0; i < count; i++) {
      const item = call(runtime, clip, CLIP, 'getItemAt', ['I'], ITEM, [i]);
      if (call(runtime, item, ITEM, 'getUri', [], 'Landroid/net/Uri;') || call(runtime, item, ITEM, 'getIntent', [], 'Landroid/content/Intent;')) throw new APKError('Virtual clipboard URI permissions and Intent transport are not implemented');
      const text = call(runtime, item, ITEM, 'getText', [], 'Ljava/lang/CharSequence;');
      if (text != null && typeof text !== 'string') throw new APKError('Virtual clipboard transport currently requires immutable plain String text');
    }
    call(runtime, clip, CLIP, 'prepareToLeaveProcess', ['Z'], 'V', [1]);
    primary = copy(runtime, clip);
    const description = call(runtime, primary, CLIP, 'getDescription', [], DESCRIPTION);
    call(runtime, description, DESCRIPTION, 'setTimestamp', ['J'], 'V', [BigInt(Date.now())]);
    notify(runtime);
  };
  return { [GC_ROOTS](visit) { visit(manager); visit(primary); },
    supports: key => keys.has(key),
    parent: type => type === MANAGER ? LEGACY : type === LEGACY ? 'Ljava/lang/Object;' : null,
    getService(runtime, name) { return name === 'clipboard' ? manager ??= runtime.makeObject(MANAGER) : null; },
    getState() { return { device: 'isolated-web-vm', hostClipboardAccess: false, hasPrimaryClip: primary != null, listeners: listeners.length }; },
    invoke(runtime, method, args) {
      if (!keys.has(`${method.owner}->${method.name}${method.signature}`)) throw new APKError('Unsupported virtual clipboard method ' + method.name);
      if (args[0]?.ref !== manager?.ref) throw new APKError('Unknown virtual clipboard service instance');
      const name = method.name;
      if (name === 'hasPrimaryClip') return primary ? 1 : 0;
      if (name === 'setPrimaryClip') return setClip(runtime, args[1]);
      if (name === 'getPrimaryClip') return primary ? copy(runtime, primary) : null;
      if (name === 'getPrimaryClipDescription') {
        if (!primary) return null;
        const source = call(runtime, primary, CLIP, 'getDescription', [], DESCRIPTION), result = runtime.allocate(DESCRIPTION);
        call(runtime, result, DESCRIPTION, '<init>', [DESCRIPTION], 'V', [source], 'direct'); return result;
      }
      if (name === 'clearPrimaryClip') { if (primary) { primary = null; notify(runtime); } return; }
      if (name === 'addPrimaryClipChangedListener') { if (listeners.length >= 256) throw new APKError('Virtual clipboard listener limit exceeded'); listeners.push(args[1]); return; }
      if (name === 'removePrimaryClipChangedListener') { const index = listeners.findIndex(value => value?.ref === args[1]?.ref); if (index >= 0) listeners.splice(index, 1); return; }
      if (name === 'setText') return setClip(runtime, call(runtime, null, CLIP, 'newPlainText', ['Ljava/lang/CharSequence;', 'Ljava/lang/CharSequence;'], CLIP, [null, args[1]], 'static'));
      if (!primary) return name === 'hasText' ? 0 : null;
      const item = call(runtime, primary, CLIP, 'getItemAt', ['I'], ITEM, [0]);
      if (name === 'getText') return call(runtime, item, ITEM, 'coerceToText', ['Landroid/content/Context;'], 'Ljava/lang/CharSequence;', [runtime.activity || platform.application]);
      if (name === 'hasText') { const text = call(runtime, item, ITEM, 'getText', [], 'Ljava/lang/CharSequence;'); return text != null && call(runtime, text, 'Ljava/lang/CharSequence;', 'length', [], 'I') > 0 ? 1 : 0; }
      throw new APKError('Unsupported virtual clipboard operation ' + name);
    },
  };
}
