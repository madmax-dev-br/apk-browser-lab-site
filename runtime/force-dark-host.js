// Force dark for the View tree (src/force-dark.js has the colour math and HWUI's rules). Android 13 decides it per window and applies it per RenderNode:
//  - ViewRootImpl.updateForceDarkMode (when the window gets its renderer, and on every configuration change): on when the window's configuration is in night mode
//    (uiMode & UI_MODE_NIGHT_MASK == UI_MODE_NIGHT_YES) and its context's theme has android:isLightTheme (default true) and android:forceDarkAllowed (default
//    debug.hwui.force_dark, false); a change re-records every display list (invalidateWorld);
//  - View.setForceDarkAllowed / android:forceDarkAllowed set RenderNode.setForceDarkAllowed: a View that disallows it turns it off for itself and everything below it
//    (RenderNode::prepareTreeImpl's TreeInfo.disableForceDark);
//  - View.drawBackground draws the background Drawable into a RenderNode of its own with RenderNode.USAGE_BACKGROUND (View.getDrawableRenderNode): darkened;
//  - the View's own RenderNode (its onDraw, compound and button drawables, foreground, text) takes RenderNode::handleForceDark's usage: text makes it foreground (lightened);
//    an unknown node with more than one child node (its background node and its child Views' nodes), or one child that is not a background, is a background (darkened);
//    the crude overlap check of a parent makes a child that contains everything drawn after it a background (sticky, as RenderNode::setUsageHint is).
// The lab draws a View as several page layers (background colour or Drawable layer, content raster, text, foreground): each one gets the transform of the RenderNode it belongs to
// on Android. Colours the page draws itself (a background colour, text and hint colours, a progress tint, the window background) are transformed in the snapshot (snapshot());
// what the VM rasterizes is transformed when its recording is replayed (src/skia-canvas-host.js, options.forceDark per layer: layerOptions()). When no window has force dark
// nothing here runs past a field read, and nothing is recorded differently.
import { transformColor, nodeTransform, USAGE_BACKGROUND } from './force-dark.js?v=67f3eead5b24';
import { getVectorGraphics } from './vector-native.js?v=67f3eead5b24';
import { renderNodeByHandle } from './rendernode-native.js?v=67f3eead5b24';

const CONTEXT = 'Landroid/content/Context;', RESOURCES = 'Landroid/content/res/Resources;', CONFIGURATION = 'Landroid/content/res/Configuration;', TA = 'Landroid/content/res/TypedArray;';
const TEXT = 'Landroid/widget/TextView;', NODE = 'Landroid/graphics/RenderNode;';
const UI_MODE_NIGHT_MASK = 0x30, UI_MODE_NIGHT_YES = 0x20;

export function createForceDarkHost(platform) {
  let frame = 0, frameWindowOn = false;
  const overlapChecked = new WeakMap();
  const call = (r, receiver, owner, name, parameters, result, values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], 'virtual');
  /** A lookup the host makes for itself: the framework code it runs is not the app's and must not evict trace entries the app's own calls made. */
  const quietly = (r, body) => { const muted = r.traceMuted; r.traceMuted = true; try { return body(); } finally { r.traceMuted = muted; } };
  /** `a.getBoolean(R.styleable.Theme_<name>, fallback)` of the context's theme (Context.obtainStyledAttributes(R.styleable.Theme)). */
  const themeBoolean = (r, context, name, fallback) => {
    const table = platform.resources?.frameworkTable, id = table?.findId('attr/' + name);
    if (!id || !platform.styleBackend) return fallback;
    const ids = r.newArray('[I', 1); r.array(ids).elements = [id];
    const array = platform.styleBackend.obtain(r, platform.styleBackend.theme(r, context), null, ids, 0);
    try { return !!call(r, array, TA, 'getBoolean', ['I', 'Z'], 'Z', [0, fallback ? 1 : 0]); } finally { call(r, array, TA, 'recycle', [], 'V'); }
  };
  /** ViewRootImpl.updateForceDarkMode for the window whose root View is `root`: its context is the Activity's for the Activity's window, the root's own for a dialog. */
  const computeWindow = (r, root) => {
    const view = r.object(root), context = r.root && r.root.ref === root.ref && r.activity ? r.activity : view.context ?? r.activity;
    if (!context || !r.classes.has(CONFIGURATION)) return false;
    return quietly(r, () => {
      const resources = call(r, context, CONTEXT, 'getResources', [], RESOURCES), configuration = resources ? call(r, resources, RESOURCES, 'getConfiguration', [], CONFIGURATION) : null;
      const uiMode = configuration ? r.object(configuration).fields.get(`${CONFIGURATION}->uiMode:I`) ?? 0 : 0;
      if ((uiMode & UI_MODE_NIGHT_MASK) !== UI_MODE_NIGHT_YES) return false;
      if (!themeBoolean(r, context, 'isLightTheme', true)) return false;
      // forceDarkAllowedDefault = SystemProperties.getBoolean(ThreadedRenderer.DEBUG_FORCE_DARK, false): the developer option "Override force-dark"
      const SP = 'Landroid/os/SystemProperties;', fallback = r.classes.has(SP) ? !!r.dispatch({ owner: SP, name: 'getBoolean', parameters: ['Ljava/lang/String;', 'Z'], result: 'Z', signature: '(Ljava/lang/String;Z)Z' }, r.argumentWords(['Ljava/lang/String;', 'Z'], ['debug.hwui.force_dark', 0], {}), 'static') : false;
      return themeBoolean(r, context, 'forceDarkAllowed', fallback);
    });
  };
  const windowOf = (r, rootRef) => { const root = r.object(rootRef); if (root.forceDarkWindow === undefined) root.forceDarkWindow = computeWindow(r, rootRef); return root.forceDarkWindow; };
  /** A window's root as the lab draws it (ViewRootImpl's view: the Activity's root, or a root a draw pass began with), not a View above it. */
  const isWindowRoot = (r, ref, view) => r.root?.ref === ref.ref || view.forceDarkWindow !== undefined;
  /** The window root of the View's parent chain, else null (a View in no window). */
  const rootOf = (r, ref) => {
    let current = ref, view = r.object(ref);
    for (let depth = 0; depth < 256 && !isWindowRoot(r, current, view) && view.parent; depth++) { current = view.parent; view = r.object(current); }
    return isWindowRoot(r, current, view) || view.attached ? current : null;
  };
  /** Force dark is on for this View: its window has it, and neither the View nor a parent disallows it (View.setForceDarkAllowed(false) / android:forceDarkAllowed="false"). */
  const active = (r, ref) => {
    let view = r.object(ref), current = ref;
    for (let depth = 0; depth < 256; depth++) {
      if (view.forceDarkAllowed === false) return false;
      if (isWindowRoot(r, current, view) || !view.parent) break;
      current = view.parent; view = r.object(current);
    }
    return (isWindowRoot(r, current, view) || !!view.attached) && windowOf(r, current);
  };
  const size = view => [Math.max(0, (view.bounds?.right ?? 0) - (view.bounds?.left ?? 0)), Math.max(0, (view.bounds?.bottom ?? 0) - (view.bounds?.top ?? 0))];
  const scroll = view => [view.fields?.get('Landroid/view/View;->mScrollX:I') ?? 0, view.fields?.get('Landroid/view/View;->mScrollY:I') ?? 0];
  /**
   * The child RenderNodes of a View's own node, in drawing order: its background node (View.drawBackground: USAGE_BACKGROUND, translated by the scroll), then the nodes of the
   * children ViewGroup.dispatchDraw draws (VISIBLE ones, not quick-rejected by a clipping parent), at their left/top plus translation.
   */
  const childNodes = (r, ref) => {
    const view = r.object(ref), [w, h] = size(view), [sx, sy] = scroll(view), out = [];
    if (view.backgroundDrawable || view.background) out.push({ hint: USAGE_BACKGROUND, x: sx, y: sy, width: w, height: h });
    for (const childRef of view.children ?? []) {
      const child = r.object(childRef), b = child.bounds;
      if ((child.visibility ?? 0) !== 0 || !b) continue;
      if (view.clipChildren !== false && (b.right - sx <= 0 || b.bottom - sy <= 0 || b.left - sx >= w || b.top - sy >= h)) continue;   // Canvas.quickReject in View.draw(Canvas, ViewGroup, long)
      const t = child.webTransform;
      out.push({ ref: childRef, hint: child.forceDarkUsageHint ?? 0, x: Math.fround(b.left + (t?.translationX ?? 0)), y: Math.fround(b.top + (t?.translationY ?? 0)), width: b.right - b.left, height: b.bottom - b.top });
    }
    return out;
  };
  // RenderNode::setUsageHint(Background) on a child View's node: kept on the View (its layers are its node here) and on the RenderNode it records through updateDisplayListIfDirty
  const markBackground = r => child => {
    if (!child.ref) return;
    const record = r.object(child.ref); record.forceDarkUsageHint = USAGE_BACKGROUND;
    const handle = record.viewRenderNode ? r.object(record.viewRenderNode).fields.get(`${NODE}->mNativeRenderNode:J`) : undefined;
    if (handle !== undefined) { try { renderNodeByHandle(r, handle).usageHint = USAGE_BACKGROUND; } catch { /* a released node */ } }
  };
  /** The parent's handleForceDark ran its crude overlap check over its children this frame (it marks the ones that contain everything drawn after them as backgrounds). */
  const checkOverlap = (r, parentRef) => {
    const parent = r.object(parentRef); if (overlapChecked.get(parent) === frame) return;
    overlapChecked.set(parent, frame);
    if (!active(r, parentRef)) return;
    const children = childNodes(r, parentRef); if (children.length > 1) nodeTransform({ children }, markBackground(r));
  };
  /** The View draws text in its own node (DisplayListData's mHasText): a TextView with text or a hint, or text ops recorded by its own onDraw. */
  const hasText = (r, view) => {
    if (r.isSubtype(view.type, TEXT) && (String(view.ellipsizedText ?? view.displayText ?? view.text ?? '') || String(view.hint ?? ''))) return true;
    const handle = view.contentCanvas ? r.object(view.contentCanvas).nativeCanvasHandle : null;
    if (handle == null) return false;
    const draws = getVectorGraphics(r).handles.get(handle)?.draws ?? [];
    return draws.some(op => op.op === 'text' || op.op === 'paragraphRun' || op.text === true);
  };
  /** The colour transform of the View's own RenderNode (RenderNode::handleForceDark), or null when force dark is off for it. */
  const contentTransform = (r, ref) => {
    if (!active(r, ref)) return null;
    const view = r.object(ref);
    if (view.parent) checkOverlap(r, view.parent);
    return nodeTransform({ hint: view.forceDarkUsageHint ?? 0, hasText: hasText(r, view), children: childNodes(r, ref) }, markBackground(r));
  };
  const parse = value => typeof value === 'string' ? (text => (parseInt(text, 16) | (text.length === 6 ? 0xff000000 : 0)) >>> 0)(value.replace('#', '')) : value >>> 0;
  const format = (original, color) => typeof original === 'string' ? '#' + (color >>> 0).toString(16).padStart(8, '0') : typeof original === 'number' && original < 0 ? color | 0 : color >>> 0;
  const transformed = (transform, value) => value === null || value === undefined || value === '' ? value : format(value, transformColor(transform, parse(value)));
  return {
    /** The window draw pass begins (ViewRootImpl.performDraw of `root`): the window's force-dark state, and invalidateWorld when it changed (text rasters are measured again). */
    beginFrame(r, root) {
      frame++;
      const view = r.object(root), before = view.forceDarkWindow, now = computeWindow(r, root);
      view.forceDarkWindow = now; frameWindowOn = now;
      if (before !== undefined && before !== now) {
        const seen = new Set(), walk = ref => { const v = r.object(ref); if (seen.has(v.id) || seen.size > 4096) return; seen.add(v.id); if (v.textRaster || v.textLayoutRaster || v.canvasTextRaster) platform.viewLayoutHost?.invoke(r, { name: 'requestLayout' }, [ref]); for (const child of v.children ?? []) walk(child); };
        walk(root); r.record(`HOST ViewRootImpl.updateForceDarkMode: force dark ${now ? 'on' : 'off'} (invalidateWorld)`);
      }
    },
    /** Every View drawn this frame: a text raster made under another force-dark state (the View was attached, moved, or allowed it since) is laid out again. */
    checkText(r, ref) {
      const view = r.object(ref); if (!view.textRaster || !frameWindowOn && !view.textRasterForceDark) return;   // the window draws without force dark and the raster was made without it
      const now = this.textTransform(r, ref); if ((view.textRasterForceDark ?? null) !== now && (view.textRasterForceDark !== undefined || now !== null)) platform.viewLayoutHost?.invoke(r, { name: 'requestLayout' }, [ref]);
    },
    active,
    /** The transform of the View's background RenderNode (USAGE_BACKGROUND): 'dark', or null. */
    backgroundTransform: (r, ref) => active(r, ref) ? 'dark' : null,
    /** A colour of a background node (makeDark). */
    backgroundColor: color => transformColor('dark', color >>> 0) | 0,
    /** The transform of the View's text (the node that draws text is foreground): 'light', or null. */
    textTransform: (r, ref) => active(r, ref) ? 'light' : null,
    contentTransform,
    /** A text colour as force dark draws it (the View's node has text: lightened). */
    textColor(r, ref, color) { const t = active(r, ref) ? 'light' : null; return t ? transformColor(t, color >>> 0) | 0 : color; },
    /** The replay options of one of the View's own layers (its content, drawable, foreground, button or overlay raster): `base` with the View node's transform. */
    layerOptions(r, ref, base) { const transform = contentTransform(r, ref); return transform ? { ...(base ?? {}), forceDark: transform } : base; },
    /** The replay options of a window background (DecorView's background node). */
    windowBackgroundOptions(r, base) { return r.root && active(r, r.root) ? { ...(base ?? {}), forceDark: 'dark' } : base; },
    /** The colours the page draws itself, in a snapshot's views (src/apk-runtime.js snapshot): the window and View backgrounds darkened, text, hints and the View's own drawing per its node. */
    snapshot(r, views) {
      const visit = (node, ancestorsAllow, windowOn) => {
        const record = r.object({ ref: node.id }), allowed = ancestorsAllow && record.forceDarkAllowed !== false, on = allowed && windowOn;
        if (on) {
          if (node.background != null) node.background = transformed('dark', node.background);
          if (node.textColor != null) node.textColor = transformed('light', node.textColor);
          if (node.hintColor != null) node.hintColor = transformed('light', node.hintColor);
          if (node.progressTint != null) { const t = contentTransform(r, { ref: node.id }); if (t) node.progressTint = transformed(t, node.progressTint); }
        }
        for (const child of node.children ?? []) visit(child, allowed, windowOn);
      };
      for (const root of views ?? []) {
        const ref = { ref: root.id }, windowOn = !!(rootOf(r, ref) && windowOf(r, rootOf(r, ref)));
        if (!windowOn) continue;
        if (root.windowBackground?.kind === 'color' && r.object(ref).forceDarkAllowed !== false) root.windowBackground = { ...root.windowBackground, argb: transformColor('dark', root.windowBackground.argb >>> 0) };
        visit(root, true, windowOn);
      }
    },
  };
}
