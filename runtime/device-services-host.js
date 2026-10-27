import { APKError } from './apk-runtime.js?v=58b0147dafd8';
const WINDOW_CONFIG = 'Landroid/app/WindowConfiguration;', RECT = 'Landroid/graphics/Rect;', MANAGER = 'Landroid/view/IWindowManager;';
const keys = new Set(['Landroid/view/WindowManagerGlobal;->getWindowManagerService()Landroid/view/IWindowManager;', `${MANAGER}->hasNavigationBar(I)Z`, `${WINDOW_CONFIG}->getMaxBounds()Landroid/graphics/Rect;`, `${WINDOW_CONFIG}->getBounds()Landroid/graphics/Rect;`, 'Landroid/app/AppGlobals;->getIntCoreSetting(Ljava/lang/String;I)I']);
for (const owner of ['Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/app/Application;', 'Landroid/app/Activity;']) keys.add(owner + '->getDisplayId()I');
/** Logical web-device display/service state. It contains no measurements or services from an Android host. */
export function createDeviceServicesHost(platform) {
  let manager = null; const coreSettings = new Map();
  const invoke = (runtime, owner, name, parameters, result, args, mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, mode);
  return {
    supports: key => keys.has(key), parent: type => type === WINDOW_CONFIG || type === MANAGER ? 'Ljava/lang/Object;' : null,
    createWindowConfiguration(runtime, existing = null, width = platform.device.widthDp, height = platform.device.heightDp) {
      const original = runtime.classes.has(WINDOW_CONFIG), ref = existing || (original ? runtime.allocate(WINDOW_CONFIG) : runtime.makeObject(WINDOW_CONFIG));
      if (!runtime.classes.has(RECT)) throw new APKError('Original AOSP Rect DEX required for virtual display bounds');
      const rect = runtime.allocate(RECT); invoke(runtime, RECT, '<init>', ['I', 'I', 'I', 'I'], 'V', [rect, 0, 0, width, height], 'direct');
      if (original) { if (!existing) invoke(runtime, WINDOW_CONFIG, '<init>', [], 'V', [ref], 'direct'); invoke(runtime, WINDOW_CONFIG, 'setMaxBounds', [RECT], 'V', [ref, rect]); invoke(runtime, WINDOW_CONFIG, 'setBounds', [RECT], 'V', [ref, rect]); }
      else runtime.object(ref).vmDisplayBounds = rect;
      return ref;
    },

    invoke(runtime, method, args) {
      if (method.name === 'getDisplayId') return 0;
      if (method.owner === WINDOW_CONFIG) { const bounds = runtime.object(args[0]).vmDisplayBounds; if (!bounds) throw new APKError('WindowConfiguration has no configured display bounds'); return bounds; }
      if (method.name === 'getWindowManagerService') { manager ??= runtime.makeObject(MANAGER); runtime.record(`DISPLAY service: virtual display 0, ${platform.device.widthDp}x${platform.device.heightDp} dp, navigationBar=true`); return manager; }
      if (method.name === 'hasNavigationBar') { if (args[0]?.ref !== manager?.ref || args[1] !== 0) throw new APKError('Unknown virtual display/window manager'); return 1; }
      if (method.name === 'getIntCoreSetting') { runtime.record(`CORE_SETTING ${args[0]} -> VM store or supplied default`); return coreSettings.get(args[0]) ?? args[1]; }
      throw new APKError('Unsupported virtual device service ' + method.name);
    },
  };
}
