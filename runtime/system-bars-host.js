import { APKError } from './apk-error.js?v=94afba6d22ec';
import { GESTURE_NAVIGATION_INSET_DP } from './device-profile.js?v=94afba6d22ec';
// SystemUI of the virtual device: status bar, navigation bar (gesture handle or 3 buttons) and the window policy PhoneWindow/DecorView apply to the app:
// edge-to-edge (targetSdk >= 35 unless windowOptOutEdgeToEdgeEnforcement, Window.setDecorFitsSystemWindows(false), SYSTEM_UI_FLAG_LAYOUT_*),
// bar colors/appearance (theme + Window setters + WindowInsetsController + SYSTEM_UI_FLAG_LIGHT_*), hiding (FLAG_FULLSCREEN, SYSTEM_UI_FLAG_FULLSCREEN/HIDE_NAVIGATION,
// WindowInsetsController.hide) and the WindowInsets the ViewRoot dispatches. The bars themselves are drawn by the page from `snapshot()`; heights come from
// the framework resource table (status_bar_height, navigation_bar_height).
const WINDOW = 'Landroid/view/Window;', VIEW = 'Landroid/view/View;', CONTROLLER = 'Landroid/view/WindowInsetsController;', INSETS = 'Landroid/view/WindowInsets;', INSETS_VALUE = 'Landroid/graphics/Insets;', TYPE = 'Landroid/view/WindowInsets$Type;';
const keys = new Set(), add = (owner, signatures) => signatures.forEach(signature => keys.add(`${owner}->${signature}`));
add(WINDOW, ['setStatusBarColor(I)V', 'getStatusBarColor()I', 'setNavigationBarColor(I)V', 'getNavigationBarColor()I', 'setNavigationBarDividerColor(I)V', 'getNavigationBarDividerColor()I', 'setDecorFitsSystemWindows(Z)V',
  'addFlags(I)V', 'clearFlags(I)V', 'setFlags(II)V', 'setNavigationBarContrastEnforced(Z)V', 'isNavigationBarContrastEnforced()Z', 'setStatusBarContrastEnforced(Z)V', 'isStatusBarContrastEnforced()Z', 'getInsetsController()Landroid/view/WindowInsetsController;']);
add(VIEW, ['setSystemUiVisibility(I)V', 'getSystemUiVisibility()I', 'getWindowSystemUiVisibility()I', 'getWindowInsetsController()Landroid/view/WindowInsetsController;']);
add(CONTROLLER, ['setSystemBarsAppearance(II)V', 'getSystemBarsAppearance()I', 'hide(I)V', 'show(I)V', 'setSystemBarsBehavior(I)V', 'getSystemBarsBehavior()I']);
const FLAG = { FULLSCREEN: 0x400, LAYOUT_NO_LIMITS: 0x200, TRANSLUCENT_STATUS: 0x04000000, TRANSLUCENT_NAVIGATION: 0x08000000, DRAWS_SYSTEM_BAR_BACKGROUNDS: 0x80000000 | 0 };
const UI = { LOW_PROFILE: 1, HIDE_NAVIGATION: 2, FULLSCREEN: 4, LAYOUT_STABLE: 0x100, LAYOUT_HIDE_NAVIGATION: 0x200, LAYOUT_FULLSCREEN: 0x400, IMMERSIVE: 0x800, IMMERSIVE_STICKY: 0x1000, LIGHT_STATUS_BAR: 0x2000, LIGHT_NAVIGATION_BAR: 0x10 };
const APPEARANCE = { LIGHT_STATUS_BARS: 8, LIGHT_NAVIGATION_BARS: 16 }, TYPES = { statusBars: 1, navigationBars: 2, captionBar: 4, ime: 8, systemGestures: 16, mandatorySystemGestures: 32, tappableElement: 64, displayCutout: 128 };
const fail = message => { throw new APKError(message, { kind: 'system-bars-unsupported' }); };
const TRANSPARENT = 0, SCRIM_DARK = 0x80000000 | 0;

export function createSystemBarsHost(platform) {
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);
  const dimension = (r, name, fallback) => {
    const table = platform.resources?.frameworkTable, id = table?.findId('dimen/' + name); if (!id) return fallback;
    let value = table.resolve(id); while (value.resolved) value = value.resolved;
    if (value.dataType !== 5) return fallback; const unit = value.rawData & 15, radix = (value.rawData >> 4) & 3, mantissa = (value.rawData >> 8) / [1, 128, 32768, 8388608][radix];
    return unit === 1 ? Math.round(mantissa) : fallback; // dip
  };
  const theme = (r, context, attr) => {
    const table = platform.resources?.frameworkTable, id = table?.findId('attr/' + attr); if (!id || !r.classes.has('Landroid/util/TypedValue;')) return null;
    const value = r.allocate('Landroid/util/TypedValue;'); call(r, value, 'Landroid/util/TypedValue;', '<init>', [], 'V', [], 'direct');
    const resources = call(r, context, 'Landroid/content/Context;', 'getTheme', [], 'Landroid/content/res/Resources$Theme;');
    if (!call(r, resources, 'Landroid/content/res/Resources$Theme;', 'resolveAttribute', ['I', 'Landroid/util/TypedValue;', 'Z'], 'Z', [id, value, 1])) return null;
    const f = r.object(value).fields, type = f.get('Landroid/util/TypedValue;->type:I') ?? 0, data = f.get('Landroid/util/TypedValue;->data:I') | 0; return { type, data };
  };
  const boolAttr = (r, context, name) => { const value = theme(r, context, name); return value && value.type === 0x12 ? !!value.data : null; };
  const colorAttr = (r, context, name) => { const value = theme(r, context, name); return value && value.type >= 0x1c && value.type <= 0x1f ? value.data | 0 : null; };
  const stateOf = (r, frame) => {
    if (frame.bars) return frame.bars;
    const context = frame.activity, themed0 = !!r.object(context).baseContext, sdk = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1), optOut = themed0 && r.classes.has('Landroid/util/TypedValue;') ? boolAttr(r, context, 'windowOptOutEdgeToEdgeEnforcement') : null;
    const themed = themed0 && platform.resources?.frameworkTable ? { status: colorAttr(r, context, 'statusBarColor'), nav: colorAttr(r, context, 'navigationBarColor'), lightStatus: boolAttr(r, context, 'windowLightStatusBar'), lightNav: boolAttr(r, context, 'windowLightNavigationBar'), fullscreen: boolAttr(r, context, 'windowFullscreen'), translucentStatus: boolAttr(r, context, 'windowTranslucentStatus'), translucentNav: boolAttr(r, context, 'windowTranslucentNavigation'), draws: boolAttr(r, context, 'windowDrawsSystemBarBackgrounds') } : {};
    frame.bars = { targetSdk: sdk, enforcedEdgeToEdge: sdk >= 35 && !optOut, decorFits: null, flags: (themed.fullscreen ? FLAG.FULLSCREEN : 0) | (themed.translucentStatus ? FLAG.TRANSLUCENT_STATUS : 0) | (themed.translucentNav ? FLAG.TRANSLUCENT_NAVIGATION : 0),
      statusColor: themed.status ?? 0xff000000 | 0, navColor: themed.nav ?? 0xff000000 | 0, draws: themed.draws ?? true, lightStatus: !!themed.lightStatus, lightNav: !!themed.lightNav, hideStatus: false, hideNav: false, navContrast: true, statusContrast: true, behavior: 1, systemUi: 0 };
    return frame.bars;
  };
  const activeFrame = r => platform.frames.at(-1) ?? null;
  const frameOfWindow = (r, window) => platform.frame(r, r.object(window).host);
  const uiFlags = (r, frame) => {
    let flags = 0; const walk = ref => { const view = r.object(ref); if (view.visibility !== 8) flags |= view.systemUiVisibility | 0; for (const child of view.children || []) walk(child); };
    if (frame.root) walk(frame.root); if (frame.window) { walk(r.object(frame.window).decor); } return flags;
  };
  /** Effective policy for a frame: everything the page and the layout need. */
  const compute = (r, frame) => {
    const bars = stateOf(r, frame), device = platform.device, flags = uiFlags(r, frame), landscape = device.orientation === 'landscape';
    const statusHeight = device.statusBarHeightDp ?? dimension(r, landscape ? 'status_bar_height_landscape' : 'status_bar_height_portrait', 24), buttonHeight = dimension(r, 'navigation_bar_height', 48), buttons = device.navigation === 'buttons';
    const navThickness = buttons ? (landscape ? dimension(r, 'navigation_bar_width', 48) : buttonHeight) : GESTURE_NAVIGATION_INSET_DP, navSide = buttons && landscape ? 'right' : 'bottom';
    const hideStatus = bars.hideStatus || !!(bars.flags & FLAG.FULLSCREEN) || !!(flags & UI.FULLSCREEN), hideNav = bars.hideNav || !!(flags & UI.HIDE_NAVIGATION);
    const layoutBehind = bars.decorFits === false || !!(flags & UI.LAYOUT_FULLSCREEN) || !!(bars.flags & FLAG.LAYOUT_NO_LIMITS) || (bars.decorFits === null && bars.enforcedEdgeToEdge);
    const edgeToEdge = bars.decorFits === false || (bars.decorFits === null && bars.enforcedEdgeToEdge) || !!(flags & UI.LAYOUT_FULLSCREEN);
    const statusVisible = !hideStatus, navVisible = !hideNav;
    const inset = { left: 0, top: statusVisible ? statusHeight : 0, right: navVisible && navSide === 'right' ? navThickness : 0, bottom: navVisible && navSide === 'bottom' ? navThickness : 0 };
    const translucentStatus = !!(bars.flags & FLAG.TRANSLUCENT_STATUS), translucentNav = !!(bars.flags & FLAG.TRANSLUCENT_NAVIGATION);
    // Bar backgrounds: with enforced edge-to-edge the app's colors are ignored (transparent gesture bar; scrim behind 3 buttons when contrast is enforced).
    let statusColor, navColor;
    if (bars.enforcedEdgeToEdge && bars.decorFits !== true) { statusColor = TRANSPARENT; navColor = buttons && bars.navContrast ? (bars.lightNav ? 0xe6ffffff | 0 : SCRIM_DARK) : TRANSPARENT; }
    else { statusColor = translucentStatus ? 0x66000000 | 0 : bars.draws ? bars.statusColor : 0xff000000 | 0; navColor = translucentNav ? 0x66000000 | 0 : bars.draws ? bars.navColor : 0xff000000 | 0; }
    const lightStatus = bars.lightStatus || !!(flags & UI.LIGHT_STATUS_BAR), lightNav = bars.lightNav || !!(flags & UI.LIGHT_NAVIGATION_BAR);
    const frameRect = edgeToEdge || layoutBehind ? { left: 0, top: 0, right: device.widthDp, bottom: device.heightDp } : { left: inset.left, top: inset.top, right: device.widthDp - inset.right, bottom: device.heightDp - inset.bottom };
    return { widthDp: device.widthDp, heightDp: device.heightDp, orientation: device.orientation, edgeToEdge, targetSdk: bars.targetSdk,
      status: { height: statusHeight, visible: statusVisible, color: statusColor >>> 0, light: lightStatus }, nav: { mode: device.navigation, thickness: navThickness, side: navSide, visible: navVisible, color: navColor >>> 0, light: lightNav },
      insets: inset, contentFrame: frameRect, gestureBottom: device.navigation === 'gesture' ? 0 : inset.bottom };
  };
  const key = value => JSON.stringify([value.edgeToEdge, value.insets, value.status.visible, value.nav.visible, value.widthDp, value.heightDp]);
  const changed = (r, frame, invalidate = true) => {
    if (!frame.window && !frame.root) return; const value = compute(r, frame), next = key(value);
    if (frame.barsKey !== next) { frame.barsKey = next; if (invalidate && frame.root) { platform.insetsHost.invalidate?.(r, frame.root); platform.viewLayoutHost.relayoutRoot?.(r, frame.root); } }
    platform.requestDraw?.(r, frame.root);
  };
  const buildInsets = (r, value) => { r.traceMuted = (r.traceMuted || 0) + 1; try { return buildInsetsUnmuted(r, value); } finally { r.traceMuted--; } };
  const buildInsetsUnmuted = (r, value) => {
    const BUILDER = 'Landroid/view/WindowInsets$Builder;';
    if (!r.classes.has(BUILDER)) return null;
    const insets = (l, t, rt, b) => r.dispatch({ owner: INSETS_VALUE, name: 'of', signature: '(IIII)' + INSETS_VALUE, parameters: ['I', 'I', 'I', 'I'], result: INSETS_VALUE }, [l, t, rt, b], 'static');
    const builder = r.allocate(BUILDER); call(r, builder, BUILDER, '<init>', [], 'V', [], 'direct');
    const set = (type, l, t, rt, b, ignoring) => { call(r, builder, BUILDER, 'setInsets', ['I', INSETS_VALUE], BUILDER, [type, insets(l, t, rt, b)]); call(r, builder, BUILDER, 'setInsetsIgnoringVisibility', ['I', INSETS_VALUE], BUILDER, [type, ignoring ?? insets(l, t, rt, b)]); };
    const stableStatus = value.status.height, stableNav = value.nav.thickness, side = value.nav.side === 'right';
    const ignoreStatus = insets(0, stableStatus, 0, 0), ignoreNav = side ? insets(0, 0, stableNav, 0) : insets(0, 0, 0, stableNav);
    const { top, bottom, right } = value.insets;
    set(TYPES.statusBars, 0, top, 0, 0, ignoreStatus); set(TYPES.navigationBars, 0, 0, right, bottom, ignoreNav);
    // Gesture navigation: the bottom inset exists for layout, but the tappable area (and mandatory gestures) ends where the gesture bar begins.
    const tappableBottom = value.nav.mode === 'buttons' ? bottom : 0;
    set(TYPES.tappableElement, 0, top, right, tappableBottom); set(TYPES.mandatorySystemGestures, 0, top, 0, value.nav.mode === 'gesture' ? Math.max(bottom, 0) : 0);
    set(TYPES.systemGestures, value.nav.mode === 'gesture' ? 24 : 0, top, value.nav.mode === 'gesture' ? 24 : right, value.nav.mode === 'gesture' ? Math.max(bottom, 0) + 8 : bottom);
    call(r, builder, BUILDER, 'setStableInsets', [INSETS_VALUE], BUILDER, [insets(0, stableStatus, side ? stableNav : 0, side ? 0 : stableNav)]);
    return call(r, builder, BUILDER, 'build', [], INSETS);
  };
  const controllerFor = (r, frame) => { if (!frame.controller) { frame.controller = r.makeObject(CONTROLLER); r.object(frame.controller).barsFrame = frame; } return frame.controller; };
  return {
    supports: key => keys.has(key), parent: type => type === CONTROLLER ? 'Ljava/lang/Object;' : null,
    /** Policy snapshot for the page, the layout and WindowInsets (null while no Activity is running). */
    describe(r, frame = activeFrame(r)) { return frame ? compute(r, frame) : null; },
    frameForRoot(r, root) { return platform.frames.find(frame => frame.root && frame.root.ref === root.ref || frame.window && r.object(frame.window).decor?.ref === root.ref) ?? null; },
    snapshot(r) { const frame = activeFrame(r); if (!frame) return null; const value = compute(r, frame); return value; },
    /** WindowInsets dispatched to an Activity root: real values when the window is edge-to-edge, consumed by the decor otherwise. */
    insetsFor(r, root) {
      const frame = this.frameForRoot(r, root); if (!frame) return null; const value = compute(r, frame);
      const effective = value.edgeToEdge ? value : { ...value, insets: { left: 0, top: 0, right: 0, bottom: 0 } };
      return { key: key(effective), build: () => buildInsets(r, effective) };
    },
    contentFrame(r, root) { const frame = this.frameForRoot(r, root); return frame ? compute(r, frame).contentFrame : null; },
    notifyChanged(r) { for (const frame of platform.frames) changed(r, frame); },
    invoke(r, method, args) {
      const name = method.name, owner = method.owner, receiver = args[0];
      if (owner === CONTROLLER) {
        const frame = r.object(receiver).barsFrame, bars = stateOf(r, frame);
        if (name === 'setSystemBarsAppearance') { const [, appearance, mask] = args; if (mask & APPEARANCE.LIGHT_STATUS_BARS) bars.lightStatus = !!(appearance & APPEARANCE.LIGHT_STATUS_BARS); if (mask & APPEARANCE.LIGHT_NAVIGATION_BARS) bars.lightNav = !!(appearance & APPEARANCE.LIGHT_NAVIGATION_BARS); changed(r, frame, false); return; }
        if (name === 'getSystemBarsAppearance') return (bars.lightStatus ? APPEARANCE.LIGHT_STATUS_BARS : 0) | (bars.lightNav ? APPEARANCE.LIGHT_NAVIGATION_BARS : 0);
        if (name === 'hide' || name === 'show') { const hide = name === 'hide'; if (args[1] & TYPES.statusBars) bars.hideStatus = hide; if (args[1] & TYPES.navigationBars) bars.hideNav = hide; changed(r, frame); return; }
        if (name === 'setSystemBarsBehavior') { bars.behavior = args[1]; return; }
        return bars.behavior;
      }
      if (owner === VIEW) {
        if (name === 'setSystemUiVisibility') { r.object(receiver).systemUiVisibility = args[1]; const frame = platform.frames.at(-1); if (frame) changed(r, frame); return; }
        if (name === 'getSystemUiVisibility') return r.object(receiver).systemUiVisibility | 0;
        if (name === 'getWindowSystemUiVisibility') { const frame = platform.frames.at(-1); return frame ? uiFlags(r, frame) : 0; }
        if (name === 'getWindowInsetsController') { const frame = platform.frames.at(-1); return frame ? controllerFor(r, frame) : null; }
      }
      const frame = frameOfWindow(r, receiver), bars = stateOf(r, frame);
      if (name === 'setStatusBarColor') { bars.statusColor = args[1] | 0; changed(r, frame, false); return; }
      if (name === 'getStatusBarColor') return bars.statusColor;
      if (name === 'setNavigationBarColor') { bars.navColor = args[1] | 0; changed(r, frame, false); return; }
      if (name === 'getNavigationBarColor') return bars.navColor;
      if (name === 'setNavigationBarDividerColor') { bars.navDivider = args[1] | 0; return; }
      if (name === 'getNavigationBarDividerColor') return bars.navDivider ?? 0;
      if (name === 'setDecorFitsSystemWindows') { bars.decorFits = !!args[1]; changed(r, frame); return; }
      if (name === 'addFlags') { bars.flags |= args[1]; changed(r, frame); return; }
      if (name === 'clearFlags') { bars.flags &= ~args[1]; changed(r, frame); return; }
      if (name === 'setFlags') { bars.flags = (bars.flags & ~args[2]) | (args[1] & args[2]); changed(r, frame); return; }
      if (name === 'setNavigationBarContrastEnforced') { bars.navContrast = !!args[1]; changed(r, frame, false); return; }
      if (name === 'isNavigationBarContrastEnforced') return bars.navContrast ? 1 : 0;
      if (name === 'setStatusBarContrastEnforced') { bars.statusContrast = !!args[1]; return; }
      if (name === 'isStatusBarContrastEnforced') return bars.statusContrast ? 1 : 0;
      if (name === 'getInsetsController') return controllerFor(r, frame);
      fail('Unsupported system-bar operation ' + name);
    },
  };
}
