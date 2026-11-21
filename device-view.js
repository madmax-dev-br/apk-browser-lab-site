// Shared Android device renderer: Views/Compose/WindowManager snapshot -> DOM, input forwarding, system bars. Used verbatim by the lab page (app.js)
// and by the embeddable player frame (player/frame.js); each supplies the page-specific chrome through `hooks`.
import { updateWebViewSlot } from './webview-slot.js?v=6954cacca256';
import { createWebViewManager, webViewIds } from './webview-frame.js?v=6954cacca256';
import { isTrustedRasterURL } from './raster-cache.js?v=6954cacca256';
import { gestureHost, claimKind, DRAG_SLOP } from './pointer-claim.js?v=6954cacca256';
/** The CSS transform of a View's 3x3 matrix (android.graphics.Matrix order): matrix() when it is affine; matrix3d(), the homography of the plane z = 0, when it has a
 *  perspective row (a View rotated about its X or Y axis: src/camera-transform.js). */
export function cssTransform(m) {
  if (m[6] === 0 && m[7] === 0 && m[8] === 1) return `matrix(${m[0]},${m[3]},${m[1]},${m[4]},${m[2]},${m[5]})`;
  return `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,${m[8]})`;
}
/** Per-instance render state (DOM element maps and pending input queues) shared with the host page's own `state` object. */
export function createViewState() {
  return { viewElements: new Map(), shadowElements: new Map(), windowSurfaceElements: new Map(), viewSession: 0, pendingInputs: new Map(), pendingFocus: [], pendingPointers: [], pendingScrollBys: new Map(), inputPromise: null, inputInFlight: null, pendingComposeActions: [], composeElements: new Map(), nativeOverlayElements: new Map(), composeInFlight: null, pendingScrolls: new Map(), scrollInFlight: null, scrollAcknowledging: null };
}
// A View's Drawable layer is a CSS background, and a CSS background whose image is not loaded yet paints nothing: given the Blob URL of every new frame of an animated
// Drawable (a ripple under a press, a state transition), the View lost its background for as long as the frames kept coming. The layer keeps the frame it shows until the
// next one has loaded (an <img> does that by itself; a background does not). Loaded images are kept (bounded), so the
// browser still has a frame that is shown again and the one a newer frame stands on.
const LOADED_LAYERS = new Map(), LOADED_LAYER_LIMIT = 256;
const layerLoaded = (url, image) => { LOADED_LAYERS.delete(url); LOADED_LAYERS.set(url, image); while (LOADED_LAYERS.size > LOADED_LAYER_LIMIT) LOADED_LAYERS.delete(LOADED_LAYERS.keys().next().value); };
/** The URL to give the element's background now for the Drawable layer `url`: `url` itself when the browser has it (or nothing is shown yet), else the frame being shown, replaced in place once `url` has loaded
 *  (a frame that loads after a newer one is shown is dropped). */
export function layerURLToShow(element, url, { createImage = () => new Image() } = {}) {
  const order = element._layerOrder = (element._layerOrder ?? 0) + 1;
  if (!url.startsWith('blob:')) { element._layerShown = undefined; element._layerShownOrder = order; return url; }   // a data: URL is in the document itself
  if (LOADED_LAYERS.has(url)) { layerLoaded(url, LOADED_LAYERS.get(url)); element._layerShown = url; element._layerShownOrder = order; return url; }
  const previous = element._layerShown && element._layerShown !== url && LOADED_LAYERS.has(element._layerShown) ? element._layerShown : null;
  if (previous === null) { element._layerShown = url; element._layerShownOrder = order; }
  const image = createImage();
  const settle = loaded => {
    if (loaded) layerLoaded(url, image);
    if (order <= element._layerShownOrder || element._layerShown === url) return;   // a newer frame is already shown
    const shown = element._layerShown; element._layerShown = url; element._layerShownOrder = order;
    if (shown && element.style.backgroundImage.includes(shown)) element.style.backgroundImage = element.style.backgroundImage.replace(shown, url);
  };
  image.src = url;
  (typeof image.decode === 'function' ? image.decode() : new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; })).then(() => settle(true), () => settle(false));
  return previous ?? url;
}
/** The CSS background-image of a View whose text is a raster: the text over the image already there (a background Drawable). After a `background` shorthand wrote a plain
 * colour the longhand reads back as a CSS-wide keyword ("initial") or "none": that is no layer, and listing it would make the whole value invalid (the text would not be drawn). */
export function stackBackgroundImage(image, existing) { return existing && !/^(?:none|initial|inherit|unset|revert)$/.test(existing) ? `${image}, ${existing}` : image; }
/** A View's raw-pixel content raster on its canvas layer. The canvas holds the raster's own pixels (a reduced-scale replay while the screen moves, src/motion-raster.js,
 * has fewer); its CSS box is the View's, so the browser stretches it over the same size. `counters.putMs` / `counters.reducedDrawn` are the page's frame stats. */
export function paintRgbaContentLayer(element, drawing, counters) {
  if (!(drawing.image?.width === drawing.width && drawing.image?.height === drawing.height && drawing.width > 0 && drawing.height > 0)) throw new Error('Invalid Canvas content pixels received from the VM.');
  if (drawing.scale !== undefined && !(drawing.scale > 0 && drawing.scale <= 1)) throw new Error('Invalid raster scale received from the VM.');
  let layer = element._contentLayer; if (!layer || layer.tagName !== 'CANVAS') { layer = element._contentLayer = document.createElement('canvas'); layer._image = null; }
  if (layer._image !== drawing.image) {
    if (layer.width !== drawing.width || layer.height !== drawing.height) { layer.width = drawing.width; layer.height = drawing.height; }
    const putStarted = globalThis.performance?.now?.() ?? Date.now(); layer.getContext('2d').putImageData(drawing.image, 0, 0); counters.putMs += (globalThis.performance?.now?.() ?? Date.now()) - putStarted; layer._image = drawing.image; layer.dataset.rasterId = drawing.rasterId;
    if (drawing.scale !== undefined && drawing.scale < 1) { layer.dataset.rasterScale = String(drawing.scale); counters.reducedDrawn++; } else delete layer.dataset.rasterScale;
    layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-canvas-content'; layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
  }
}
/** A GPU frame (renderer "GPU (experimental)", src/gpu-raster.js): the ImageBitmap the Worker transferred is drawn on the content layer's canvas (a GPU copy, no pixel decode). */
export function paintBitmapContentLayer(element, drawing, counters) {
  if (!(drawing.image?.width === drawing.width && drawing.image?.height === drawing.height && drawing.width > 0 && drawing.height > 0)) throw new Error('Invalid Canvas content GPU frame received from the VM.');
  if (drawing.scale !== undefined && !(drawing.scale > 0 && drawing.scale <= 1)) throw new Error('Invalid raster scale received from the VM.');
  let layer = element._contentLayer; if (!layer || layer.tagName !== 'CANVAS') { layer = element._contentLayer = document.createElement('canvas'); layer._image = null; }
  if (layer._image !== drawing.image) {
    if (layer.width !== drawing.width || layer.height !== drawing.height) { layer.width = drawing.width; layer.height = drawing.height; }
    const putStarted = globalThis.performance?.now?.() ?? Date.now(), context = layer.getContext('2d'); context.clearRect(0, 0, drawing.width, drawing.height); context.drawImage(drawing.image, 0, 0); counters.putMs += (globalThis.performance?.now?.() ?? Date.now()) - putStarted; layer._image = drawing.image; layer.dataset.rasterId = drawing.rasterId;
    counters.bitmapsDrawn = (counters.bitmapsDrawn ?? 0) + 1;
    if (drawing.scale !== undefined && drawing.scale < 1) { layer.dataset.rasterScale = String(drawing.scale); counters.reducedDrawn++; } else delete layer.dataset.rasterScale;
    layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-canvas-content'; layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0';
  }
}
/**
 * ctx: { $ (id lookup), state, deviceState ({settings, bars, clockTimer}), hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, clickView, notifyParent, hooks }
 * hooks: navigationChanged(canGoBack), closed(snapshot), rendered(snapshot, composeReady).
 */
/** One input RPC, retried while another VM operation holds the Worker (a device-settings change, an app-data edit...): a "VM busy" refusal is not a failure of the
 * app, the input simply waits its turn (up to ~5 s, then the refusal surfaces as before). */
export async function whenVmFree(call, { attempts = 200, waitMs = 25 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await call(); }
    catch (error) { if (error?.kind !== 'vm-busy' || attempt >= attempts) throw error; await new Promise(resolve => setTimeout(resolve, waitMs)); }
  }
}

export function createDeviceView(ctx) {
const { $, state, deviceState, hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, notifyParent, hooks = {} } = ctx, clickView = id => ctx.clickView(id);
// VM timer events (animations, handlers) can arrive faster than the display refreshes: only the newest is rendered, once per frame. An RPC result
// (renderSnapshot called directly) is always newer than a queued event, so renderSnapshot clears the queue.
let webviews = null;   // the page side of the WebViews of the bound VM (src/webview-frame.js); null when the host disables WebView
const runtimeFrames = { pending: null, requested: false, vmBusy: false, coalesced: 0, rendered: 0, seq: 0, drawMs: 0, semanticsMs: 0, putMs: 0, reducedDrawn: 0, log: [], drawn: [] };   // reducedDrawn: reduced-scale rasters put on a canvas (src/motion-raster.js)   // log: arrival of each runtime snapshot (page clock, frames the Worker had produced, snapshots drawn so far) for the produced-vs-displayed measurement
// The next display frame, or FRAME_FALLBACK_MS later when the browser is not painting this page: a background tab, a covered window or a hidden pane runs no animation frames,
// and the VM's newest snapshot would wait for one forever. The page then held a stale screen (the last frame it drew, "Screen ready" never arriving), which is what an MCP client or
// a plugin reads while nobody is looking at the tab. With the timer the state stays current; a visible page still draws on the display's own frame.
const FRAME_FALLBACK_MS = 250;
const nextFrame = globalThis.requestAnimationFrame ? callback => {
  let done = false, frame = 0, timer = 0;
  const run = () => { if (done) return; done = true; clearTimeout(timer); globalThis.cancelAnimationFrame?.(frame); callback(); };
  frame = globalThis.requestAnimationFrame(run); timer = setTimeout(run, FRAME_FALLBACK_MS);
} : callback => setTimeout(callback, 16);
function flushRuntimeSnapshot(vm) {
  runtimeFrames.requested = false; const snapshot = runtimeFrames.pending; runtimeFrames.pending = null;
  if (!snapshot || state.runtime !== vm) return;
  const drawStarted = nowMs();
  try { renderSnapshot(snapshot); } catch (error) { reportAPKError(error, 'Failed to render a VM callback'); }
  runtimeFrames.drawMs += nowMs() - drawStarted;
  vm.ackFrame?.(runtimeFrames.seq);   // drawn (or failed): the Worker may take the next snapshot
}
/** Route the Worker client's asynchronous snapshots/errors (timers, animations) into this view. */
function bindVM(vm) {
  vm.onRuntimeBusy = busy => { runtimeFrames.vmBusy = busy; ctx.frameMeter?.busyChanged(busy); };   // frameMeter: "Show frame rate" (src/frame-meter.js), which ignores everything while the option is off   // a scheduled VM event is being processed (frame, timer): the screen is not settled yet
  vm.onRuntimeSnapshot = (snapshot, seq) => {
    runtimeFrames.vmBusy = false;
    if (state.runtime !== vm) return;
    ctx.frameMeter?.received(snapshot);
    if (runtimeFrames.log.length < 50000) runtimeFrames.log.push([Date.now(), snapshot?.vmHealth?.framesProduced ?? null]);
    if (runtimeFrames.pending) runtimeFrames.coalesced++;
    if (Number.isSafeInteger(seq)) runtimeFrames.seq = seq;
    runtimeFrames.pending = snapshot; if (!runtimeFrames.requested) { runtimeFrames.requested = true; nextFrame(() => flushRuntimeSnapshot(vm)); }
  };
  vm.onRuntimeError = error => { if (state.runtime === vm) reportAPKError(error, 'Asynchronous callback interrupted'); };
  // A lab error that ended a background thread of the app. The reply that carried the JavaScript exception (if any did) may already be on screen; either way the panel stays until the
  // person reopens, relaunches or goes back: the frames the app keeps producing (the other threads go on) used to hide it at once, and the app looked like it was loading forever.
  vm.onThreadFailure = failure => {
    if (state.runtime !== vm) return;
    const error = Object.assign(new Error(String(failure.message ?? 'An app thread was interrupted by a lab error.')), { details: { kind: failure.kind ?? 'thread-failure', thread: failure.thread } });
    state.stickyError = true; reportAPKError(error, `Thread "${failure.thread ?? '?'}" interrompida`);
  };
  if (ctx.webViews !== false) { webviews?.close(); webviews = createWebViewManager({ send: event => vm.webViewEvent?.(event) }); vm.onWebView = message => { if (state.runtime === vm) webviews.handle(message); }; }
}
function reconcileChildren(parent, children) {
  children.forEach((child, index) => { if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null); });
  for (const child of [...parent.children]) if (!children.includes(child)) child.remove();
}
// AndroidView widgets remain actual native View objects in the snapshot. Their
// HTML controls are transparent input/accessibility surfaces over the Canvas;
// composition/layers continue to draw exclusively through original DEX.
function renderNativeCanvasOverlays(views) {
  const activeLayers = new Set(), activeWrappers = new Set(), needed = new Map();
  const nativeControl = view => ['input', 'button', 'check', 'image', 'progress', 'text'].includes(view.kind) || !!view.clickable && !view.type?.startsWith('Landroidx/compose/');
  const branchNeeded = view => { if (needed.has(view.id)) return needed.get(view.id); const value = nativeControl(view) || (view.children || []).some(branchNeeded); needed.set(view.id, value); return value; };
  const overlay = (view, parent) => {
    if (!branchNeeded(view)) return null;
    const b = view.bounds;
    if (!view.laidOut || !b || ![b.left,b.top,b.right,b.bottom].every(Number.isFinite) || b.right <= b.left || b.bottom <= b.top) return null;
    const interactive = nativeControl(view), scroll = view.kind === 'scroll';
    let element;
    if (interactive || scroll) {
      element = createView(view, parent.kind, true, parent.clipChildren !== false, false);
      element.style.opacity = '0'; element.style.minWidth = '0'; element.style.minHeight = '0';
      element.style.pointerEvents = interactive || scroll ? 'auto' : 'none'; element.dataset.canvasNative = 'true';
    } else {
      const key = String(view.id); element = state.nativeOverlayElements.get(key);
      if (!element) { element = document.createElement('div'); element.className = 'android-native-overlay-group'; element.setAttribute('role', 'presentation'); state.nativeOverlayElements.set(key, element); }
      activeWrappers.add(key);
      element.style.cssText = `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right-b.left}px;height:${b.bottom-b.top}px;margin:0;padding:0;border:0;pointer-events:none`;
      if (parent.clipChildren !== false) element.style.clipPath = 'inset(0)';
      if (view.transformMatrix) { const m = view.transformMatrix; if (!Array.isArray(m) || m.length !== 9 || m.some(value => !Number.isFinite(value))) throw new Error('Invalid matrix in the AndroidView overlay.'); element.style.transformOrigin = '0 0'; element.style.transform = cssTransform(m); }
      if (view.visibility === 8) element.style.display = 'none'; else if (view.visibility === 4) element.style.visibility = 'hidden';
    }
    if (!interactive || ['linear','frame','scroll','group'].includes(view.kind)) {
      const clip = element._nativeClip ||= document.createElement('div'), content = element._nativeContent ||= document.createElement('div'), padding = view.padding || {};
      clip.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      if (!scroll && view.clipToPadding !== false) clip.style.clipPath = `inset(${padding.top || 0}px ${padding.right || 0}px ${padding.bottom || 0}px ${padding.left || 0}px)`;
      content.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      if (!scroll && (view.scrollX || view.scrollY)) content.style.transform = `translate(${-view.scrollX || 0}px,${-view.scrollY || 0}px)`;
      reconcileChildren(content, (view.children || []).map(child => overlay(child, view)).filter(Boolean));
      reconcileChildren(clip, [content]); reconcileChildren(element, [clip]);
    }
    return element;
  };
  const visit = view => {
    const host = state.viewElements.get(String(view.id));
    if (view.canvasChildrenCaptured && view.contentRaster && host && inAndroidWindow(host)) {
      const children = (view.children || []).map(child => overlay(child, view)).filter(Boolean);
      if (children.length) {
        const layer = host._nativeOverlayLayer ||= document.createElement('div'); activeLayers.add(layer);
        layer.className = 'android-native-canvas-overlay'; layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3';
        if (view.scrollX || view.scrollY) layer.style.transform = `translate(${-view.scrollX || 0}px,${-view.scrollY || 0}px)`;
        reconcileChildren(layer, children); if (layer.parentNode !== host) host.append(layer);
      }
    } else for (const child of view.children || []) visit(child);
  };
  views.forEach(visit);
  for (const element of state.viewElements.values()) if (element._nativeOverlayLayer && !activeLayers.has(element._nativeOverlayLayer)) element._nativeOverlayLayer.remove();
  for (const [key, element] of state.nativeOverlayElements) if (!activeWrappers.has(key)) { element.remove(); state.nativeOverlayElements.delete(key); }
}

function syncNativeScroll(views) {
  for (const view of views) {
    if (view.kind === 'scroll') {
      const element = state.viewElements.get(String(view.id)), pending = state.pendingScrolls.has(view.id) || state.scrollInFlight === view.id && state.scrollAcknowledging !== view.id;
      if (element && inAndroidWindow(element) && !pending) {
        const x = Number.isInteger(view.scrollX) ? view.scrollX : 0, y = Number.isInteger(view.scrollY) ? view.scrollY : 0;
        if (Math.round(element.scrollLeft) !== x) element.scrollLeft = x;
        if (Math.round(element.scrollTop) !== y) element.scrollTop = y;
        element._vmScroll = { x: Math.round(element.scrollLeft), y: Math.round(element.scrollTop) };
      }
    }
    syncNativeScroll(view.children || []);
  }
}
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
// Rasters reach the page as Blob URLs created by the raster cache (trusted); raw data URLs are still accepted after the same validation as before.
const pngURLOk = url => typeof url === 'string' && (isTrustedRasterURL(url) || (url.length <= 24 * 1024 * 1024 && PNG_DATA_URL.test(url)));
const cssColor = (argb) => /^#[0-9a-f]{8}$/i.test(argb || '') ? `#${argb.slice(3)}${argb.slice(1, 3)}` : '';

/** The navigation bar's background and icon colour. The gesture handle follows the app's light/dark request as on Android. The three buttons must stay usable whatever the app
 * painted: over an opaque bar colour the icons take the contrasting tone of that colour (an app that paints a white bar without asking for dark icons would hide them),
 * and over a transparent bar they sit on a dark scrim. */
function navBarPaint(nav) {
  const argb = nav.color >>> 0, alpha = (argb >>> 24) / 255;
  if (nav.mode !== 'buttons') return { background: argbToCSS(argb), foreground: nav.light ? '#1b1b1f' : '#ffffff', adaptive: alpha < 0.5 };   // over a transparent bar the handle takes its tone from what is behind it, as SystemUI samples the content (styles.css .adaptive)
  if (alpha < 0.5) return { background: 'rgba(0,0,0,0.4)', foreground: '#ffffff' };
  const luminance = (0.2126 * ((argb >>> 16) & 255) + 0.7152 * ((argb >>> 8) & 255) + 0.0722 * (argb & 255)) / 255;
  return { background: argbToCSS(argb), foreground: luminance > 0.55 ? '#1b1b1f' : '#ffffff' };
}
const argbToCSS = argb => { const a = argb >>> 0; return `rgba(${(a >>> 16) & 255},${(a >>> 8) & 255},${a & 255},${((a >>> 24) / 255).toFixed(3)})`; };
function formatClock(date = new Date()) {
  const settings = deviceState.settings;
  try { return new Intl.DateTimeFormat(settings.locale, { hour: settings.hour24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !settings.hour24, timeZone: settings.timeZone || undefined }).format(date).replace(/\s?(AM|PM)$/i, ''); }
  catch { return date.toTimeString().slice(0, 5); }
}
function updateSystemBarIcons() {
  const { connectivity, battery } = deviceState.settings, device = $('android-device'); if (!device) return;
  $('sysbar-clock').textContent = formatClock();
  $('sysbar-wifi').hidden = connectivity !== 'online'; $('sysbar-cell').hidden = connectivity === 'offline';
  $('sysbar-battery-level').style.height = `${battery.level}%`; $('sysbar-bolt').hidden = !battery.charging;
  $('sysbar-battery-level').style.opacity = battery.level <= 15 && !battery.charging ? '.55' : '1';
}
globalThis.addEventListener?.('resize', () => { if (deviceState.bars) fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); });
function startClock() { clearInterval(deviceState.clockTimer); updateSystemBarIcons(); deviceState.clockTimer = setInterval(updateSystemBarIcons, 15000); }
/** Scale the whole device to the preview stage (CSS transform) and expose the screen extent in dp. */
function fitDevice(widthDp, heightDp) {
  const device = $('android-device'), stage = $('preview-stage'); if (!device || !stage) return;
  const available = { w: Math.max(120, stage.clientWidth - (deviceState.stagePadding ?? 24)), h: Math.max(160, stage.clientHeight - (deviceState.stagePadding ? deviceState.stagePadding / 2 : 16)) }, fitted = Math.min(deviceState.maxScale ?? 0.7, available.w / (widthDp + 10), available.h / (heightDp + 10)), zoom = deviceState.zoom, scale = Number.isFinite(zoom) && zoom > 0 && !stage.classList.contains('device-fullscreen') ? zoom : fitted;   // a zoom chosen on the stage (src/device-zoom.js) is absolute; fullscreen always fits
  device.style.setProperty('--screen-w', String(widthDp)); device.style.setProperty('--screen-h', String(heightDp)); device.style.setProperty('--scale', scale.toFixed(4));
}
function renderSystemBars(bars) {
  const device = $('android-device'); if (!device || !bars) return; deviceState.bars = bars;
  fitDevice(bars.widthDp, bars.heightDp);
  const status = $('sysbar-status'), nav = $('sysbar-nav'), content = $('android-content');
  device.style.setProperty('--status-h', String(bars.status.height)); device.style.setProperty('--nav-h', String(bars.nav.thickness));
  status.hidden = !bars.status.visible; status.style.setProperty('--sb-bg', argbToCSS(bars.status.color)); device.style.setProperty('--sb-fg', bars.status.light ? '#1b1b1f' : '#ffffff'); device.style.setProperty('--sb-bg', argbToCSS(bars.status.color));
  nav.hidden = !bars.nav.visible; nav.classList.toggle('buttons', bars.nav.mode === 'buttons'); nav.classList.toggle('side-right', bars.nav.side === 'right'); { const paint = navBarPaint(bars.nav); device.style.setProperty('--nav-bg', paint.background); device.style.setProperty('--nav-fg', paint.foreground); nav.classList.toggle('adaptive', !!paint.adaptive); }
  const frame = bars.contentFrame; Object.assign(content.style, { left: `${frame.left}px`, top: `${frame.top}px`, width: `${frame.right - frame.left}px`, height: `${frame.bottom - frame.top}px` });
  if (!deviceState.clockTimer) startClock(); else updateSystemBarIcons();
}

let liveShadowKeys = new Set();
function shadowElement(child) {
  const shadow = child.shadow, key = String(child.id); if (shadow) liveShadowKeys.add(key);
  if (!shadow) { state.shadowElements.delete(key); return null; }
  if (!child.bounds || !['z', 'margin', 'width', 'height'].every(name => Number.isFinite(shadow[name])) || shadow.width <= 0 || shadow.height <= 0 || !pngURLOk(shadow.dataURL)) throw new Error('Invalid View shadow received from the VM.');
  let element = state.shadowElements.get(key);
  if (!element) { element = document.createElement('img'); element.className = 'android-view-shadow'; element.alt = ''; element.draggable = false; element.setAttribute('aria-hidden', 'true'); state.shadowElements.set(key, element); }
  if (element.src !== shadow.dataURL) element.src = shadow.dataURL;
  element.dataset.viewId = key; element.dataset.z = String(shadow.z);
  const shadowCSS = `position:absolute;left:${child.bounds.left - shadow.margin}px;top:${child.bounds.top - shadow.margin}px;width:${shadow.width}px;height:${shadow.height}px;max-width:none;pointer-events:none;user-select:none`;
  if (element._css !== shadowCSS) { element.style.cssText = shadowCSS; element._css = shadowCSS; }
  return element;
}
const SIGNATURE_SKIP = new Set(['children', 'image']);   // `image`: the ImageData of a raw-pixel raster (identified in the signature by its rasterId; walking its bytes costs ~200 ms)
function viewSignature(view, parentKind, parentLaidOut, clipOwnBounds, renderChildren, focusBusy) {
  return `${parentKind}|${parentLaidOut}|${clipOwnBounds}|${renderChildren}|${focusBusy}|${state.viewSession}|${JSON.stringify(view, (key, value) => SIGNATURE_SKIP.has(key) ? undefined : value)}`;
}
function createView(view, parentKind = '', parentLaidOut = false, clipOwnBounds = false, renderChildren = true) {
  if (!view || typeof view !== 'object') throw new Error('The VM returned an invalid interface tree.');
  const kind = view.kind, key = String(view.id);
  let element = state.viewElements.get(key);
  if (element?.dataset.kind !== kind) element = null;
  if (!element) {
    const session = state.viewSession;
    if (kind === 'button') { element = document.createElement('button'); element.type = 'button'; element.addEventListener('click', () => { if (element._session === state.viewSession) clickView(view.id); }); }
    else if (kind === 'input') { element = document.createElement('input'); element.type = 'text'; for (const event of ['focus', 'blur']) element.addEventListener(event, () => { if (session !== state.viewSession) return; if (state.pendingFocus.length >= 128) { reportAPKError(new Error('A fila de foco excedeu 128 eventos; reabra o APK.'), 'Focus queue interrupted'); return; } state.pendingFocus.push({ id: view.id, focused: event === 'focus' }); flushPendingInputs(); }); element.addEventListener('input', () => { if (session !== state.viewSession) return; state.pendingInputs.set(view.id, element.value); flushPendingInputs(); }); }
    else if (kind === 'check') { element = document.createElement('label'); element._control = document.createElement('input'); element._control.type = 'checkbox'; element._label = document.createElement('span'); element.append(element._control, element._label); element._control.addEventListener('change', () => { if (element._session === state.viewSession) checkView(view.id, element._control.checked); }); }
    else if (kind === 'progress') element = document.createElement('progress');
    else if (['linear', 'frame', 'scroll', 'text', 'image', 'group', 'view', 'webview'].includes(kind)) { element = document.createElement('div'); if (kind === 'text' || kind === 'image' || kind === 'view') { element.addEventListener('click', () => { if (element._session === state.viewSession && element.dataset.clickable === 'true') clickView(view.id); }); element.addEventListener('keydown', (event) => { if (element._session === state.viewSession && element.dataset.clickable === 'true' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); clickView(view.id); } }); } }
    else throw new Error(`Interface type not supported by the renderer: ${view.type || kind}.`);
    // Touch/pointer down presses the View (drawable state + StateListAnimator elevation); up/cancel/leave releases it.
    // A clickable View of another kind (a list row, a text, an image) is pressed the same way when the pointer goes down on it and not on a control inside it: the
    // innermost clickable View takes the touch, as ViewGroup.dispatchTouchEvent gives it to the deepest child that handles it.
    const ownControl = kind === 'button' || kind === 'check';
    if (ownControl || ['linear', 'frame', 'group', 'text', 'image', 'view'].includes(kind)) for (const [event, pressed] of [['pointerdown', true], ['pointerup', false], ['pointercancel', false], ['pointerleave', false]]) element.addEventListener(event, pointer => {
      if (session !== state.viewSession || !!element._pressed === pressed || element.disabled) return;
      if (!ownControl && pressed) { if (element.dataset.clickable !== 'true' || pointer.button > 0) return; const control = pointer.target?.closest?.('button,input,[data-kind="check"],[data-clickable="true"]'); if (control && control !== element) return; if (insideComposeHost(pointer.target, element)) return; }
      element._pressed = pressed;
      if (state.pendingFocus.length >= 128) return;
      // The touch point in the View's own pixels (the element may be shown scaled): the hotspot of the View's Drawables, where a ripple starts.
      const rect = element.getBoundingClientRect(), scale = rect.width / (element.offsetWidth || rect.width) || 1, at = pressed && Number.isFinite(pointer?.clientX) ? { x: (pointer.clientX - rect.left) / scale, y: (pointer.clientY - rect.top) / scale } : {};
      state.pendingFocus.push({ id: view.id, pressed, ...at }); flushPendingInputs();
    });
    // A View that scrolls itself (src/scrolling-view.js: a RecyclerView, a NestedScrollView, a ViewPager, an original ScrollView / HorizontalScrollView / list, any subclass):
    // the wheel or a trackpad scroll is an ACTION_SCROLL generic motion event from SOURCE_MOUSE, which enters the window at its root and reaches the View under the pointer
    // (ViewGroup.dispatchGenericPointerEvent), whose own onGenericMotionEvent scrolls it. The innermost such element under the pointer queues it, once; a pinch (ctrl + wheel)
    // stays the browser's zoom.
    if (view.selfScroll) { element.dataset.listScroll = 'true'; element.addEventListener('wheel', event => {
      if (element._session !== state.viewSession || !state.runtime || event.defaultPrevented || event.ctrlKey) return; event.preventDefault();
      const rect = element.getBoundingClientRect(), scale = rect.width / (element.offsetWidth || rect.width) || 1, unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.offsetHeight : 1;
      queueWheel({ ownerViewId: view.id, action: 8, x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale, dx: event.deltaX * unit / scale, dy: event.deltaY * unit / scale, t: event.timeStamp });
    }, { passive: false }); }
    if (kind === 'scroll') element.addEventListener('scroll', () => {
      if (session !== state.viewSession || !state.runtime || state.lastAPKError) return;
      const x = Math.round(element.scrollLeft), y = Math.round(element.scrollTop);
      if (element._vmScroll?.x === x && element._vmScroll?.y === y) return;
      if (!state.pendingScrolls.has(view.id) && state.pendingScrolls.size >= 128) { reportAPKError(new Error('A fila de rolagem excedeu 128 Views.'), 'Scroll queue interrupted'); return; }
      state.pendingScrolls.set(view.id, { x, y }); flushPendingInputs();
    });
    element.className = `android-view android-${kind}`; element.dataset.kind = kind; element.dataset.viewId = key; element._session = state.viewSession; state.viewElements.set(key, element);
  }
  // Own-properties pass (attributes/style/rasters of this View): skipped when nothing the VM reported for this View, its render context or its DOM focus changed.
  const focused = document.activeElement === element, signature = viewSignature(view, parentKind, parentLaidOut, clipOwnBounds, renderChildren, focused && (state.pendingInputs.has(view.id) || state.inputInFlight === view.id));
  if (element._signature !== signature) {
  if (kind === 'button' || kind === 'text') element.textContent = view.ellipsizedText ?? view.displayText ?? view.text ?? '';
  // A case-only TransformationMethod (android:textAllCaps) or a line TextUtils.ellipsize cut: the element shows what Android draws; TextView.getText() is still the original text,
  // kept for tools that look a control up by it.
  if (kind === 'button' || kind === 'text') { const shown = String(view.ellipsizedText ?? view.displayText ?? view.text ?? ''), source = String(view.text ?? ''), cased = String(view.displayText ?? view.text ?? ''); if (source !== shown && (source.toLowerCase() === cased.toLowerCase())) element.dataset.sourceText = source; else delete element.dataset.sourceText; }
  if (view.textInContent) element.dataset.textInContent = 'true'; else delete element.dataset.textInContent;   // the glyphs are in the content raster: the element keeps its text for accessibility and typing, transparent (styles.css)
  if (kind === 'button') element.disabled = view.clickable === false || view.enabled === false;
  if (kind === 'text' || kind === 'image' || kind === 'view') { element.dataset.clickable = String(!!view.clickable && view.enabled !== false); element.tabIndex = view.clickable && view.enabled !== false ? 0 : -1; if (view.clickable) element.setAttribute('role', 'button'); else element.removeAttribute('role'); }
  if (kind === 'button' || view.clickable && ['text','view'].includes(kind)) element.setAttribute('aria-label', view.contentDescription || view.displayText || view.text || `Action ${view.androidId || view.id}`);
  if (kind === 'image') { element.setAttribute('role', view.clickable ? 'button' : 'img'); element.setAttribute('aria-label', view.contentDescription || 'APK image'); }
  if (kind === 'input') { if (!(focused && (state.pendingInputs.has(view.id) || state.inputInFlight === view.id)) && element.value !== (view.text ?? '')) element.value = view.text ?? ''; element.readOnly = !!view.readOnly; element.placeholder = view.hint || ''; element.setAttribute('aria-label', view.contentDescription || view.hint || `Field ${view.androidId || view.id}`); element.disabled = view.enabled === false; element.inputMode = (view.inputType & 15) === 2 ? 'decimal' : 'text'; }
  // A compound button whose indicator the VM draws (its button drawable: view.buttonSVG at buttonBounds; a Switch's track and thumb), or that draws itself (SwitchCompat,
  // MaterialSwitch, MaterialCheckBox: its onDraw is the content layer), or that has no indicator at all (a Chip): the page's own checkbox only takes the input, invisible.
  const vmIndicator = kind === 'check' && (!!view.switchWidget || !!view.buttonSVG || !!view.textInContent || view.indicator === false);
  if (kind === 'check') { element._control.checked = !!view.checked; element._control.disabled = view.enabled === false; element._control.setAttribute('aria-label', view.text || 'Option'); element._label.textContent = view.text || ''; element.classList.toggle('android-switch', view.type?.includes('/Switch;') && !vmIndicator); element.classList.toggle('android-switch-vm', vmIndicator); }
  if (kind === 'check') {
    const drawing = view.buttonSVG && view.buttonBounds ? view.buttonSVG : null;
    if (drawing) {
      const layer = element._buttonLayer ||= document.createElement('img'), b = view.buttonBounds;
      if (drawing.kind !== 'raster' || !pngURLOk(drawing.dataURL)) throw new Error('Invalid compound button indicator received from the VM.');
      if (layer._url !== drawing.dataURL) { layer.src = drawing.dataURL; layer._url = drawing.dataURL; layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-button-indicator'; }
      layer.style.cssText = `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right - b.left}px;height:${b.bottom - b.top}px;pointer-events:none;z-index:0`;
      if (layer.parentNode !== element) element.insertBefore(layer, element._control);
    } else { element._buttonLayer?.remove(); element._buttonLayer = null; }
  }
  if (kind === 'webview') updateWebViewSlot(element, view.webview, { manager: webviews });
  if (kind === 'progress') { element.max = view.max ?? 100; if (view.indeterminate) element.removeAttribute('value'); else element.value = view.progress || 0; }
  element.style.cssText = '';
  // ViewGroup.clipChildren clips each child's RenderNode to its own bounds.
  if (clipOwnBounds) element.style.clipPath = 'inset(0)';
  if (Number.isFinite(view.renderAlpha)) element.style.opacity = String(view.renderAlpha);
  if (view.transformMatrix) { const m = view.transformMatrix; if (!Array.isArray(m) || m.length !== 9 || m.some(value => !Number.isFinite(value))) throw new Error('Invalid View transformation'); element.style.transformOrigin = '0 0'; element.style.transform = cssTransform(m); }   // a rotation about the X or Y axis gives a perspective row: matrix3d
  if (view.defaultFocusHighlightEnabled === false) element.style.outline = 'none';
  if (kind === 'linear') element.style.flexDirection = view.orientation === 'horizontal' ? 'row' : 'column';
  if (view.laidOut && view.bounds) { element.style.width = `${view.bounds.right - view.bounds.left}px`; element.style.height = `${view.bounds.bottom - view.bounds.top}px`; if (parentLaidOut) { element.style.position = 'absolute'; element.style.left = `${view.bounds.left}px`; element.style.top = `${view.bounds.top}px`; } }
  if (Number.isFinite(view.textLineHeight) && view.textLineHeight > 0) { element.style.lineHeight = `${view.textLineHeight}px`; element.style.fontFamily = 'AndroidSkiaRoboto, AndroidRoboto, sans-serif'; element.style.fontKerning = 'none'; }
  if (view.laidOut && ['group', 'frame', 'linear', 'scroll', 'webview'].includes(kind)) element.style.position = parentLaidOut ? 'absolute' : 'relative';
  if (kind === 'webview') { if (!element.style.position) element.style.position = 'relative'; element.style.overflow = 'hidden'; }   // the iframe fills the View's box and is clipped to it
  if (Number.isFinite(view.textSize) && view.textSize > 0) element.style.fontSize = `${Math.min(200, view.textSize)}px`;
  if (view.padding) element.style.padding = `${view.padding.top || 0}px ${view.padding.right || 0}px ${view.padding.bottom || 0}px ${view.padding.left || 0}px`;
  // The text of a TextView / Button the page draws itself sits where TextView.onDraw puts it: inside the compound padding (the drawables' space), moved down by the vertical gravity's
  // offset, its content box exactly the measured text block (a <button> would center it again in a taller box). The VM decided the lines: the element never wraps them again.
  const textBox = (kind === 'text' || kind === 'button') && view.textPadding && Number.isFinite(view.textBlockHeight) && view.laidOut && view.bounds ? view.textPadding : null;
  if (textBox) {
    const top = (textBox.top || 0) + (view.textOffsetY || 0), height = view.bounds.bottom - view.bounds.top;
    element.style.padding = `${top}px ${textBox.right || 0}px ${Math.max(0, height - top - view.textBlockHeight)}px ${textBox.left || 0}px`; element.style.whiteSpace = 'pre';
  }
  // A VM-drawn Switch (thumb/track rasterized with the background) reserves its width through TextView compound padding; the native input only receives input.
  if (kind === 'check' && view.switchWidget && view.compoundPadding) element.style.padding = `${view.compoundPadding.top || 0}px ${view.compoundPadding.right || 0}px ${view.compoundPadding.bottom || 0}px ${view.compoundPadding.left || 0}px`;
  // its label, like a TextView's text: inside the compound padding (the indicator's space), at the vertical gravity's offset
  if (vmIndicator && view.textPadding && Number.isFinite(view.textBlockHeight) && view.laidOut && view.bounds) {
    const box = view.textPadding, top = (box.top || 0) + (view.textOffsetY || 0), height = view.bounds.bottom - view.bounds.top;
    element.style.display = 'block'; element.style.whiteSpace = 'pre'; element.style.padding = `${top}px ${box.right || 0}px ${Math.max(0, height - top - view.textBlockHeight)}px ${box.left || 0}px`;
    if (Number.isFinite(view.textLineHeight) && view.textLineHeight > 0) element.style.lineHeight = `${view.textLineHeight}px`;
    const gravity = view.gravity > 0 ? view.gravity & 7 : 0; element.style.textAlign = gravity === 1 ? 'center' : gravity === 5 ? 'right' : '';
  }
  if (view.margin && !(view.laidOut && parentLaidOut)) element.style.margin = `${view.margin.top || 0}px ${view.margin.right || 0}px ${view.margin.bottom || 0}px ${view.margin.left || 0}px`;
  if (!view.laidOut && Number.isFinite(view.layoutWidth)) element.style.width = view.layoutWidth === -1 ? '100%' : view.layoutWidth === -2 ? 'max-content' : `${view.layoutWidth}px`;
  if (!view.laidOut && Number.isFinite(view.layoutHeight)) { if (view.layoutHeight >= 0) element.style.height = `${view.layoutHeight}px`; else if (view.layoutHeight === -1) element.style.height = '100%'; }
  if (view.weight > 0) { element.style.flexGrow = String(view.weight); element.style.flexShrink = '1'; element.style.flexBasis = '0'; }
  if (Number.isFinite(view.textFontWeight)) { element.style.fontFamily = 'AndroidSkiaRoboto, AndroidRoboto, sans-serif'; element.style.fontWeight = String(view.textFontWeight); element.style.fontStyle = view.textFontItalic ? 'italic' : 'normal'; }
  if (view.textStyle & 1) element.style.fontWeight = '700'; if (view.textStyle & 2) element.style.fontStyle = 'italic';
  if (view.textAllCaps !== undefined) element.style.textTransform = view.textAllCaps ? 'uppercase' : 'none';
  // The text properties of an EditText, or of a compound button's label, that the page's own element draws (textViewApi.pageTextStyle): Paint letter spacing is in ems like
  // CSS letter-spacing, the shadow layer is a text-shadow, the OpenType feature settings are font-feature-settings, a serif or monospace system family is the browser's
  // generic family of that name.
  if (kind === 'input' || kind === 'check') {
    const css = view.textCss ?? null, finite = values => values.every(value => Number.isFinite(value));
    if (css && (typeof css !== 'object' || !finite([css.letterSpacing]) || Math.abs(css.letterSpacing) > 8 || (css.shadow && (!finite([css.shadow.radius, css.shadow.dx, css.shadow.dy, css.shadow.color]) || css.shadow.radius < 0 || css.shadow.radius > 512 || Math.abs(css.shadow.dx) > 4096 || Math.abs(css.shadow.dy) > 4096)) || !Array.isArray(css.features) || css.features.length > 64 || css.features.some(feature => !/^[A-Za-z0-9 ]{4}$/.test(feature?.name) || !Number.isInteger(feature.value) || feature.value < 0 || feature.value > 65535) || ![null, 'serif', 'monospace'].includes(css.family ?? null))) throw new Error('Invalid text field style received from the VM.');
    element.style.letterSpacing = css?.letterSpacing ? `${css.letterSpacing}em` : '';
    element.style.textShadow = css?.shadow ? `${css.shadow.dx}px ${css.shadow.dy}px ${css.shadow.radius}px rgba(${css.shadow.color >>> 16 & 255}, ${css.shadow.color >>> 8 & 255}, ${css.shadow.color & 255}, ${(css.shadow.color >>> 24) / 255})` : '';
    element.style.fontFeatureSettings = css?.features.length ? css.features.map(feature => `"${feature.name}" ${feature.value}`).join(', ') : '';
    if (css?.family) element.style.fontFamily = css.family;
  }
  if (kind === 'progress') { const tint = cssColor(view.progressTint) || '#009688'; element.style.setProperty('--android-progress-color', tint); element.style.accentColor = tint; }
  if (kind === 'scroll') { element.style.overflow = 'auto'; element.style.overscrollBehavior = 'contain'; }
  if (kind === 'scroll' && view.fillViewport) element.dataset.fillViewport = 'true'; else delete element.dataset.fillViewport;
  if (view.textColor) element.style.color = cssColor(view.textColor);
  if (kind === 'input') element.style.setProperty('--android-hint-color', view.hintColor ? cssColor(view.hintColor) : '');   // '' removes it (CSSOM setProperty)
  // a password field shows its PasswordTransformationMethod's dots (TextView.getText is still the typed text: the element keeps it for typing and for tools)
  if (kind === 'input') element.style.webkitTextSecurity = view.password ? 'disc' : '';
  if (view.background) element.style.background = cssColor(view.background);
  if (view.drawableSVG) {
    const drawing = view.drawableSVG; let url;
    if (drawing.kind === 'raster') { url = drawing.dataURL; if (!pngURLOk(url)) throw new Error('Invalid or excessive PNG raster received from the VM.'); }
    else { const svg = typeof drawing === 'string' ? drawing : drawing.svg; if (typeof svg !== 'string' || svg.length > 2 * 1024 * 1024 || !svg.trimStart().startsWith('<svg')) throw new Error('Invalid or excessive vector drawing state.'); url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
    element.style.backgroundImage = `url("${layerURLToShow(element, url)}")`; element.style.backgroundRepeat = 'no-repeat'; element.style.backgroundSize = '100% 100%';
  } else element._layerShown = undefined;
  // The VM owns geometry: the page stylesheet's 48px minimums/web borders must not alter laid-out bounds, and a
  // VM-drawn background Drawable (original ripple/inset/9-patch DEX) replaces the web control's own decoration.
  if (view.laidOut && view.bounds) { element.style.minHeight = '0'; element.style.minWidth = '0'; }
  if (view.drawableSVG && ['input', 'button'].includes(kind)) { element.style.border = '0'; element.style.borderRadius = '0'; element.style.boxShadow = 'none'; element.style.backgroundColor = 'transparent'; }
  if (view.textRaster && ['text', 'button'].includes(kind)) {
    const drawing = view.textRaster;
    if (!pngURLOk(drawing.dataURL) || !Number.isFinite(drawing.width) || !Number.isFinite(drawing.height)) throw new Error('Invalid paragraph PNG received from the VM.');
    const box = view.textPadding || view.compoundPadding || view.padding, image = `url("${drawing.dataURL}")`, size = `${drawing.width}px ${drawing.height}px`, position = `${box?.left || 0}px ${(box?.top || 0) + (view.textOffsetY || 0) + (view.textParagraph?.padTop || 0)}px`;
    element.style.backgroundImage = stackBackgroundImage(image, element.style.backgroundImage);
    element.style.backgroundSize = view.drawableSVG ? `${size}, 100% 100%` : size;
    element.style.backgroundPosition = view.drawableSVG ? `${position}, 0 0` : position;
    element.style.backgroundRepeat = 'no-repeat'; element.style.color = 'transparent'; element.style.textShadow = 'none';
  }
  const gravity = view.gravity > 0 ? view.gravity : 0;
  if ((gravity & 7) === 1) { element.style.textAlign = 'center'; if (kind === 'linear') element.style.alignItems = 'center'; }
  if ((gravity & 7) === 5) { element.style.textAlign = 'right'; if (kind === 'linear') element.style.alignItems = 'flex-end'; }
  if ((gravity & 0x70) === 0x10 && kind === 'linear') element.style.justifyContent = 'center';
  if ((gravity & 0x70) === 0x50 && kind === 'linear') element.style.justifyContent = 'flex-end';
  const layoutGravity = view.layoutGravity > 0 ? view.layoutGravity : 0;
  if (parentKind === 'frame' && !(view.laidOut && parentLaidOut)) { element.style.alignSelf = (layoutGravity & 0x70) === 0x50 ? 'end' : (layoutGravity & 0x70) === 0x10 ? 'center' : 'start'; element.style.justifySelf = (layoutGravity & 7) === 5 ? 'end' : (layoutGravity & 7) === 1 ? 'center' : 'start'; }
  else if (layoutGravity && !(view.laidOut && parentLaidOut)) { element.style.alignSelf = (layoutGravity & 7) === 5 ? 'flex-end' : (layoutGravity & 1) ? 'center' : 'flex-start'; element.style.justifySelf = (layoutGravity & 7) === 5 ? 'end' : (layoutGravity & 1) ? 'center' : 'start'; }
  if (view.visibility === 8) element.style.display = 'none'; else if (view.visibility === 4) element.style.visibility = 'hidden';
  if (view.enabled === false) element.setAttribute('aria-disabled', 'true'); else element.removeAttribute('aria-disabled');
  if (view.cameraSurface || element._cameraInfo) hooks.cameraSurface?.(element, view.cameraSurface ?? null);
  if (view.glSurface || element._glInfo) hooks.glSurface?.(element, view.glSurface ?? null);   // a SurfaceView with an EGL window surface: the page draws its frames (src/gl-surfaces.js)   // a TextureView / SurfaceView: the page draws the camera stream in its box (src/camera-lab.js); after the styles above, which it completes
  element._signature = signature;
  }
  if (['linear', 'frame', 'scroll', 'group'].includes(kind)) {
    // An original list (ListView, a menu popup's list, an AlertDialog's list) is "clickable" for its own touch handling, not for an OnClickListener: the page sends it the pointer
    // as real MotionEvents and the list decides which row was tapped; controls inside a row keep their own click.
    const touchInput = !!view.touchInput, clickable = !!view.clickable && !touchInput;
    element.dataset.clickable = String(clickable && view.enabled !== false);
    if (clickable) { element.setAttribute('role', 'button'); element.tabIndex = view.enabled !== false ? 0 : -1; } else { element.removeAttribute('role'); element.removeAttribute('tabindex'); }
    if (touchInput && view.bounds) bindPointerInput(element, { ownerViewId: view.id, width: view.bounds.right - view.bounds.left, height: view.bounds.bottom - view.bounds.top }, { skipControls: true });
    if (!element._groupClickInstalled) {
      element._groupClickInstalled = true;
      element.addEventListener('click', event => { if (element.dataset.clickable !== 'true' || element._session !== state.viewSession) return; const control = event.target.closest('button,input,[data-kind="check"],[data-clickable="true"]'); if (control && control !== element) return; if (insideComposeHost(event.target, element)) return; event.stopPropagation(); clickView(view.id); });
      element.addEventListener('keydown', event => { if (event.target === element && element._session === state.viewSession && element.dataset.clickable === 'true' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); clickView(view.id); } });
    }
    // A child with Z>0 has its Skia shadow raster drawn by the parent, beneath the child and before its content (HWUI order).
    const children = view.canvasChildrenCaptured || !renderChildren ? [] : (view.children || []).flatMap(child => { const body = createView(child, kind, !!view.laidOut, view.clipChildren !== false), shadow = shadowElement(child); return shadow ? [shadow, body] : [body]; });
    const padding = view.padding || {};
    // The children move with the group's scroll position (View.mScrollX / mScrollY: ViewGroup.drawChild draws each child translated by -scroll), as a NestedScrollView,
    // HorizontalScrollView or ViewPager scrolls; a DOM ScrollView ('scroll') scrolls its own overflow instead. A View that scrolls itself always has the layer (no reparenting of
    // its children when it starts to scroll); another group gets it the first time it has a scroll position, and keeps it. Its children are clipped to its bounds, as
    // ViewGroup clipToPadding (the default) clips them to the padded box, which the padding layer below does when there is a padding. Children the VM drew into the group's
    // own Canvas, or that the native overlay of a Compose AndroidView places (renderChildren false), are already where the scroll puts them.
    const scrolled = renderChildren && !view.canvasChildrenCaptured && kind !== 'scroll' && !!view.laidOut && (!!view.selfScroll || !!view.scrollX || !!view.scrollY || !!element._scrollLayer);
    let childNodes = children;
    if (scrolled) {
      const layer = element._scrollLayer ||= document.createElement('div'), sx = Number.isFinite(view.scrollX) ? view.scrollX : 0, sy = Number.isFinite(view.scrollY) ? view.scrollY : 0;
      layer.className = 'android-scroll-layer'; const css = `position:absolute;inset:0${sx || sy ? `;transform:translate(${-sx}px,${-sy}px)` : ''}`; if (layer._css !== css) { layer.style.cssText = css; layer._css = css; }
      reconcileChildren(layer, children); childNodes = [layer];
      if (view.clipToPadding !== false && !element.style.clipPath) element.style.clipPath = 'inset(0)';
    }
    if (kind !== 'scroll' && view.laidOut && view.clipToPadding !== false && Object.values(padding).some(value => value > 0)) {
      // dispatchDraw clips only children, preserving the parent's background.
      const layer = element._childLayer ||= document.createElement('div');
      layer.className = 'android-child-layer'; layer.style.cssText = `position:absolute;inset:0;clip-path:inset(${padding.top || 0}px ${padding.right || 0}px ${padding.bottom || 0}px ${padding.left || 0}px)`;
      reconcileChildren(layer, childNodes); reconcileChildren(element, [element._contentLayer, layer, element._overlayLayer, element._foregroundLayer, element._semanticsLayer, element._nativeOverlayLayer, !renderChildren ? element._nativeClip : null].filter(Boolean));
    } else reconcileChildren(element, [element._contentLayer, ...childNodes, element._overlayLayer, element._foregroundLayer, element._semanticsLayer, element._nativeOverlayLayer, !renderChildren ? element._nativeClip : null].filter(Boolean));
  }
  if (view.canvasChildrenCaptured && !view.contentRaster) throw new Error('The Canvas capture did not return a content image.');
  // The View's own Canvas content (its onDraw) goes under its children, as View.draw orders it (onDraw, then dispatchDraw, then the foreground): the content layer is the
  // element's first child. A recording with no draw at all (a ViewGroup whose onDraw drew nothing, typically the window's root) gets no layer: a transparent composited canvas
  // stretched over the whole subtree is a layer the browser has to keep in step with everything under it, and the screen was seen keeping an old picture under one until
  // something else repainted that area (a hover, a resize).
  const contentDrawing = view.contentRaster && view.contentRaster.drawCalls !== 0 ? view.contentRaster : null;
  if (contentDrawing) {
    const drawing = contentDrawing;
    // An <input>/<progress> cannot hold a layer. A subclass that draws itself (its onDraw ran on a Canvas, with the text/track the superclass draws) is shown by that drawing, as the
    // element's background; the control stays on top for typing, focus and accessibility, with its own glyphs transparent so nothing is drawn twice.
    const replaced = kind === 'input' || kind === 'progress';
    if (drawing.kind === 'rgba-raster') paintRgbaContentLayer(element, drawing, runtimeFrames);   // raw pixels from the VM (src/raster-cache.js): put on a canvas, no PNG decode
    else if (drawing.kind === 'bitmap-raster') paintBitmapContentLayer(element, drawing, runtimeFrames);   // GPU renderer (opt-in): an ImageBitmap drawn on the same canvas layer
    else {
      let layer = element._contentLayer; if (!layer || layer.tagName !== 'IMG') layer = element._contentLayer = document.createElement('img');
      if (drawing.kind !== 'raster' || !pngURLOk(drawing.dataURL) || !(drawing.width > 0 && drawing.height > 0)) throw new Error('Invalid Canvas content PNG received from the VM.');
      if (layer._url !== drawing.dataURL) { layer.src = drawing.dataURL; layer._url = drawing.dataURL; layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-canvas-content'; layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0'; }
    }
    const layer = element._contentLayer;
    if (replaced) {
      if (kind === 'progress') { element.classList.add('android-progress-vm'); element.style.backgroundColor = 'transparent'; }   // the VM's drawing is the bar: the page's own track and value are not drawn over it
      const source = layer.tagName === 'CANVAS' ? layer._image : layer._url;
      if (element._backgroundSource !== source) { element._backgroundSource = source; element._backgroundURL = `url("${layer.tagName === 'CANVAS' ? layer.toDataURL('image/png') : layer._url}")`; }
      if (element.style.backgroundImage !== element._backgroundURL) { element.style.backgroundImage = element._backgroundURL; element.style.backgroundSize = '100% 100%'; element.style.backgroundRepeat = 'no-repeat'; }   // a `background` shorthand written by the styling above resets the image
    } else {
      if (!element.style.position) element.style.position = 'relative';
      if (layer.parentNode !== element) element.insertBefore(layer, element.firstChild ?? element.children[0] ?? null);
    }
  } else { element._contentLayer?.remove(); element._contentLayer = null; if (kind === 'progress') element.classList.remove('android-progress-vm'); if (element._backgroundSource !== undefined) { element._backgroundSource = undefined; element.style.backgroundImage = ''; } }
  // What a group's draw(Canvas) override drew after its children (a TextInputLayout's floating hint): a layer over the children, under the foreground.
  if (view.overlaySVG && ['linear', 'frame', 'scroll', 'group'].includes(kind)) {
    const drawing = view.overlaySVG, layer = element._overlayLayer ||= document.createElement('img');
    if (drawing.kind !== 'raster' || !pngURLOk(drawing.dataURL)) throw new Error('Invalid overlay PNG received from the VM.');
    if (layer._url !== drawing.dataURL) { layer.src = drawing.dataURL; layer._url = drawing.dataURL; layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-overlay-layer'; layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1'; }
    if (!element.style.position) element.style.position = 'relative';
    if (layer.parentNode !== element) element.append(layer);
  } else { element._overlayLayer?.remove(); element._overlayLayer = null; }
  if (view.foregroundSVG) {
    if (kind === 'input' || kind === 'progress') throw new Error('A foreground over this native HTML control requires a drawing container.');
    const drawing = view.foregroundSVG, layer = element._foregroundLayer ||= document.createElement('img');
    let url;
    if (drawing.kind === 'raster') { url = drawing.dataURL; if (!pngURLOk(url)) throw new Error('Invalid foreground PNG received from the VM.'); }
    else { const svg = typeof drawing === 'string' ? drawing : drawing.svg; if (typeof svg !== 'string' || svg.length > 2 * 1024 * 1024 || !svg.trimStart().startsWith('<svg')) throw new Error('Invalid foreground SVG received from the VM.'); url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
    if (layer._url !== url) { layer.src = url; layer._url = url; layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-foreground-layer'; layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1'; }
    if (!element.style.position) element.style.position = 'relative';
    if (layer.parentNode !== element) element.append(layer);
  } else element._foregroundLayer?.remove();
  return element;
}
// This layer exposes only the APK's public accessibility actions. All visible
// Compose pixels come from the original Canvas callbacks captured by the VM.
function queueComposeAction(ownerViewId, nodeId, action, args = []) {
  if (!state.runtime || state.lastAPKError) return;
  if (action === 'ime') {   // keys of the page keyboard: consecutive keys for one field travel together (at most IME_OPS_PER_REQUEST per request), in order with everything else
    const key = `${ownerViewId}:${nodeId}`;
    for (const op of args) {
      const last = state.pendingComposeActions.at(-1);
      if (last?.key === key && last.action === 'ime' && last.args.length < IME_OPS_PER_REQUEST) last.args.push(op);
      else if (state.pendingComposeActions.length < 128) state.pendingComposeActions.push({ key, ownerViewId, nodeId, action, args: [op], session: state.viewSession, control: state.composeElements.get(key) });
      else { reportAPKError(new Error('The Compose action queue exceeded 128 events; reopen the APK.'), 'Accessibility queue interrupted'); return; }
    }
    return flushPendingInputs();
  }
  const key = `${ownerViewId}:${nodeId}`, entry = { key, ownerViewId, nodeId, action, args, session: state.viewSession, control: state.composeElements.get(key) };
  const last = state.pendingComposeActions.at(-1);
  // Coalesce only adjacent text replacements; a click remains ordered after
  // every preceding edit, including edits entered while an RPC is in flight.
  const before = state.pendingComposeActions.at(-2);
  if (action === 'SetText' && last?.key === key && last.action === action) last.args = args;
  else if (action === 'SetSelection' && last?.key === key && last.action === action) last.args = args;
  else if (action === 'SetText' && last?.key === key && last.action === 'SetSelection' && before?.key === key && before.action === 'SetText') { before.args = args; return flushPendingInputs(); }   // the pair of an edit: the following selection is updated next
  else if (state.pendingComposeActions.length < 128) state.pendingComposeActions.push(entry);
  else { reportAPKError(new Error('The Compose action queue exceeded 128 events; reopen the APK.'), 'Accessibility queue interrupted'); return; }
  flushPendingInputs();
}
/** A click whose press started on Compose content already reached the app as real MotionEvents through the window (src/pointer-input-host.js): Android decided there whether a
 * clickable parent View gets it. The DOM click that bubbles out of the Compose host must not click the parent a second time. */
function insideComposeHost(target, stop) {
  for (let node = target; node && node !== stop; node = node.parentNode ?? node.parentElement) if (node._pointerBound) return true;
  return false;
}
// ---- The page keyboard (Compose text fields). Android key codes and meta states of android.view.KeyEvent.
const IME_OPS_PER_REQUEST = 64, META_SHIFT = 0x41, META_ALT = 0x12, META_CTRL = 0x3000, KEYCODE_DEL = 67, KEYCODE_FORWARD_DEL = 112, KEYCODE_Z = 54;
const CURSOR_KEYS = { ArrowLeft: 21, ArrowRight: 22, ArrowUp: 19, ArrowDown: 20, Home: 122, End: 123, PageUp: 92, PageDown: 93 };
/** The served view of the VM's InputMethodManager is this Compose owner and it has an InputConnection (snapshot.ime, src/input-method-service-host.js imeState). */
function imeServes(ownerViewId) { const ime = state.imeState; return !!ime?.connected && ime.servedViewId === ownerViewId; }
/** What Android's keyboard sends for a textarea edit (InputEvent.inputType), or null for an edit it has no key for (that one reaches the app through SetText, as before).
 * Text, deletions and Enter always go through the keyboard path (the Worker falls back to SetText when the field has no InputConnection); keys that only exist as key events
 * (word deletion, undo/redo) do so only while the field has a connection, so without one the browser's edit still reaches the app. */
function keyboardOperation(event, connected) {
  const type = event.inputType, data = event.data ?? event.dataTransfer?.getData?.('text/plain') ?? '';
  switch (type) {
    case 'insertText': case 'insertReplacementText': case 'insertFromPaste': case 'insertFromDrop': case 'insertFromYank': return data ? { kind: 'commit', text: String(data) } : null;
    case 'insertLineBreak': case 'insertParagraph': return { kind: 'enter' };
    case 'deleteContentBackward': case 'deleteByCut': case 'deleteByDrag': case 'deleteContent': return { kind: 'deleteBackward' };
    case 'deleteContentForward': return { kind: 'deleteForward' };
  }
  if (!connected) return null;
  switch (type) {   // hardware-keyboard chords Compose's text field handles (KeyMapping): Ctrl+Backspace / Ctrl+Delete a word, Alt+Backspace / Alt+Delete to the line edge, Ctrl+Z / Ctrl+Shift+Z
    case 'deleteWordBackward': return { kind: 'key', code: KEYCODE_DEL, meta: META_CTRL };
    case 'deleteWordForward': return { kind: 'key', code: KEYCODE_FORWARD_DEL, meta: META_CTRL };
    case 'deleteSoftLineBackward': case 'deleteHardLineBackward': return { kind: 'key', code: KEYCODE_DEL, meta: META_ALT };
    case 'deleteSoftLineForward': case 'deleteHardLineForward': return { kind: 'key', code: KEYCODE_FORWARD_DEL, meta: META_ALT };
    case 'historyUndo': return { kind: 'key', code: KEYCODE_Z, meta: META_CTRL };
    case 'historyRedo': return { kind: 'key', code: KEYCODE_Z, meta: META_CTRL | META_SHIFT };
  }
  return null;
}
/** Applies a key to the textarea the way the browser would have (its value is invisible; the next snapshot replaces it with the app's) and returns that text: the SetText fallback. */
function echoEdit(control, op) {
  const value = control.value, start = Math.min(control.selectionStart ?? value.length, control.selectionEnd ?? value.length), end = Math.max(control.selectionStart ?? value.length, control.selectionEnd ?? value.length);
  const low = at => { const c = value.charCodeAt(at); return c >= 0xdc00 && c <= 0xdfff; }, high = at => { const c = value.charCodeAt(at); return c >= 0xd800 && c <= 0xdbff; };
  let next = value, caret = start;
  if (op.kind === 'commit' || op.kind === 'enter') { const text = op.kind === 'enter' ? '\n' : op.text; next = value.slice(0, start) + text + value.slice(end); caret = start + text.length; }
  else if (op.kind === 'deleteBackward') { if (start !== end) next = value.slice(0, start) + value.slice(end); else if (start > 0) { const n = start > 1 && low(start - 1) && high(start - 2) ? 2 : 1; next = value.slice(0, start - n) + value.slice(start); caret = start - n; } }
  else if (op.kind === 'deleteForward') { if (start !== end) next = value.slice(0, start) + value.slice(end); else if (start < value.length) { const n = high(start) && low(start + 1) ? 2 : 1; next = value.slice(0, start) + value.slice(start + n); } }
  else return null;
  control.value = next; try { control.setSelectionRange(caret, caret); } catch { /* detached */ }
  return next;
}
const POINTER_CLICKS_DEFAULT = true;   // taps reach the app as real MotionEvents (the press ripple animates under them); ?pointerClicks=semantic on the player frame selects the OnClick path
  const pointerClicks = () => deviceState.pointerClicks ?? POINTER_CLICKS_DEFAULT;   // ?pointerClicks=real|semantic on the player frame overrides it (validation runs both)
/**
 * Mouse/touch/pen on a View that takes real pointer input (a Compose view, an original list, a View that scrolls itself) -> VM pointer samples (real MotionEvents). Overlay
 * controls are descendants, so their events bubble here too. Bound elements nest; a gesture is sent once, by the outermost bound element that takes it (src/pointer-claim.js):
 * every sample enters the window at its root, as on Android. With skipControls, a press on a View control inside keeps the control's own click; it becomes a gesture only when
 * the pointer moves past DRAG_SLOP before it lifts (DOWN where it went down, then the moves), and the click the browser fires after such a drag is not delivered.
 */
function bindPointerInput(host, owner, { skipControls = false } = {}) {
  host._composeOwner = owner;   // refreshed on every render: width/height/ids may change
  if (host._pointerBound) return; host._pointerBound = true; host._pointerOptions = { skipControls }; host.dataset.pointerHost = 'true';
  const session = state.viewSession, local = event => {
    const rect = host.getBoundingClientRect(), width = host.offsetWidth || host._composeOwner.width || rect.width, scale = rect.width / width || 1;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };
  const send = (action, event) => {
    if (session !== state.viewSession || !state.runtime || state.lastAPKError || !host._composeOwner) return;
    if (state.pendingPointers.length >= 512) return;
    const point = local(event); state.pendingPointers.push({ ownerViewId: host._composeOwner.ownerViewId, action, x: point.x, y: point.y, t: event.timeStamp });
    flushPendingInputs();
  };
  let active = null, pending = null;
  // Move/up/cancel are tracked on the whole frame window while a gesture is active (or while a press on a control may become one): pointer capture on the (re-rendered) host
  // element would be lost on DOM updates.
  const track = event => {
    if (pending && event.pointerId === pending.pointerId) {
      const from = local(pending), to = local(event); if (Math.hypot(to.x - from.x, to.y - from.y) < DRAG_SLOP) return;
      const down = pending; pending = null; active = down.pointerId; host._swallowClick = true; markTouch(down); send(0, down);
    }
    if (event.pointerId === active) send(2, event);
  };
  const stop = () => { win.removeEventListener('pointermove', track, true); win.removeEventListener('pointerup', onUp, true); win.removeEventListener('pointercancel', onCancel, true); };
  const finish = (action, event) => {
    if (pending && event.pointerId === pending.pointerId) { pending = null; stop(); return; }   // the press stayed on its control: the control's own click
    if (event.pointerId !== active) return; active = null; stop(); send(action, event);
    if (host._swallowClick) setTimeout(() => { host._swallowClick = false; }, 0);   // the click that follows this pointerup is dispatched in the same task
  };
  const onUp = event => finish(1, event), onCancel = event => finish(3, event), win = host.ownerDocument?.defaultView ?? globalThis;
  host.style.touchAction = 'none';   // the app owns touch panning inside its view (also [data-pointer-host] in styles.css: a re-render resets the inline style)
  // A press on a control that turned into a drag: the browser still clicks the control when the pointer lifts on it; on Android the drag cancelled the control's touch.
  host.addEventListener('click', event => { if (!host._swallowClick) return; host._swallowClick = false; event.stopPropagation(); event.preventDefault(); }, true);
  host.addEventListener('pointerdown', event => {
    if (active !== null || pending !== null || event.button > 0) return;
    // Interim: in the semantic pointer mode, taps on clickable controls keep the semantic OnClick path; gestures that semantics cannot express (slider drags, touch scrolling
    // and flings, anything on non-clickable content) are real pointer input.
    const options = { pointerClicks: pointerClicks() };
    if (gestureHost(host, event.target, options) !== host) return;   // not this element's to take, or an outer bound element sends it
    const kind = claimKind(host, event.target, options); host._swallowClick = false;
    win.addEventListener('pointermove', track, true); win.addEventListener('pointerup', onUp, true); win.addEventListener('pointercancel', onCancel, true);
    if (kind === 'deferred') { pending = event; return; }   // a View control inside a list row is clicked through its own element, unless the press turns into a drag
    active = event.pointerId; markTouch(event);
    send(0, event);
  });
}
/** A wheel / trackpad scroll sample (ACTION_SCROLL) for the VM: consecutive samples of the same View that have not been sent yet add up into one. */
function queueWheel(sample) {
  if (!state.runtime || state.lastAPKError) return;
  const last = state.pendingPointers.at(-1);
  if (last && last.action === 8 && last.ownerViewId === sample.ownerViewId) { last.dx += sample.dx; last.dy += sample.dy; last.x = sample.x; last.y = sample.y; last.t = sample.t; }
  else { if (state.pendingPointers.length >= 512) return; state.pendingPointers.push(sample); }
  flushPendingInputs();
}
/** A mark where the finger went down, at once (the app's own press ripple only shows when the VM's next frame arrives). */
function markTouch(event) {
  const screen = document.getElementById('android-screen'); if (!screen?.getBoundingClientRect) return;
  const r = screen.getBoundingClientRect(), scale = r.width / (screen.offsetWidth || r.width || 1), mark = document.createElement('span'); mark.className = 'touch-mark';
  mark.style.left = `${(event.clientX - r.left) / scale}px`; mark.style.top = `${(event.clientY - r.top) / scale}px`; screen.append(mark); setTimeout(() => mark.remove(), 520);
}
function renderComposeSemantics(snapshot) {
  if (!document.getElementById('compose-accessibility-style')) {
    const style = document.createElement('style'); style.id = 'compose-accessibility-style';
    style.textContent = '.compose-semantic-control:focus-visible{outline:2px solid #315ce8;outline-offset:-2px}.compose-semantic-control::selection{background:transparent;color:transparent}input[type=range].compose-semantic-control{-webkit-appearance:none;appearance:none;background:transparent}input[type=range].compose-semantic-control::-webkit-slider-runnable-track{background:transparent}input[type=range].compose-semantic-control::-webkit-slider-thumb{-webkit-appearance:none;opacity:0}input[type=range].compose-semantic-control::-moz-range-track,input[type=range].compose-semantic-control::-moz-range-thumb{background:transparent;border:0;opacity:0}';
    document.head.append(style);
  }
  const owners = snapshot.composeSemantics?.owners || [], views = new Map(), active = new Set(), layers = new Set();
  const visit = view => { views.set(String(view.id), view); for (const child of view.children || []) visit(child); };
  snapshot.views.forEach(visit);
  let readyOwners = 0;
  for (const owner of owners) {
    const id = String(owner.ownerViewId), view = views.get(id), host = state.viewElements.get(id);
    if (!owner.attached || !view?.contentRaster || !view.canvasChildrenCaptured || !host || !inAndroidWindow(host)) continue;
    // The Worker reuses a tree between walks (src/semantics-pacing.js) and stamps every walk with a `version`: the controls of the same tree on the same elements need no DOM work (a frame of a
    // scrolling list used to rewrite every control's style and attributes for a tree that had not changed). Text fields and sliders are always rendered: their DOM state (focus, caret, value) follows the page.
    const treeVersion = snapshot.composeSemantics?.version, memo = host._semanticsMemo, unchanged = !!memo && treeVersion !== undefined && memo.version === treeVersion && memo.session === state.viewSession && memo.layer === host._semanticsLayer;
    const nodes = owner.nodes || [];
    if (nodes.length > 4096) throw new Error('Compose accessibility tree too large.');
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    const visible = node => { const seen = new Set(); while (node) { if (node.invisibleToUser || seen.has(node.nodeId)) return false; seen.add(node.nodeId); node = byId.get(node.parentId); } return true; };
    bindPointerInput(host, owner);
    const layer = host._semanticsLayer ||= document.createElement('div');
    layer.className = 'compose-semantics-layer'; layer.style.cssText = 'position:absolute;inset:0;padding:0;margin:0;pointer-events:none;overflow:hidden;z-index:2';
    layers.add(layer); const controls = [], controlKeys = []; let hasPlacedContent = false;
    for (const node of nodes) {
      const b = node.boundsInRoot;
      if (!visible(node) || !node.placed || !b || ![b.left,b.top,b.right,b.bottom].every(Number.isFinite) || b.right <= 0 || b.bottom <= 0 || b.left >= owner.width || b.top >= owner.height) continue;
      const actions = new Set((node.actions || []).map(action => action.name)), texts = [...(node.contentDescriptions || []), ...(node.texts || [])].filter(value => typeof value === 'string' && value.length);
      const editable = actions.has('SetText'), activation = ['OnClick', 'Dismiss', 'Expand', 'Collapse'].find(action => actions.has(action)), clickable = !!activation, scrollable = actions.has('ScrollBy');
      const slider = actions.has('SetProgress') && !!node.rangeInfo;
      if (!editable && !clickable && !scrollable && !slider && !texts.length) continue;
      hasPlacedContent = true;
      const key = `${owner.ownerViewId}:${node.nodeId}`, kind = editable ? 'input' : slider ? 'slider' : clickable ? 'button' : 'text';
      let control = state.composeElements.get(key);
      if (control?.dataset.controlKind !== kind) control = null;
      if (control && unchanged && !editable && !slider && memo.controls.get(key) === control) { active.add(key); controls.push(control); controlKeys.push(key); continue; }
      if (!control) {
        control = document.createElement(editable ? 'textarea' : slider ? 'input' : clickable ? 'button' : 'div');
        control.dataset.controlKind = kind; control.className = 'compose-semantic-control';
        const session = state.viewSession;
        control.addEventListener('click', event => event.stopPropagation());
        if (editable) {
          // The page's keyboard types like Android's soft keyboard: each edit of the textarea (beforeinput) becomes the InputConnection call an IME makes on the served
          // AndroidComposeView (commitText, deleteSurroundingText, setComposingText, performEditorAction, sendKeyEvent; src/input-method-service-host.js imeEdit), the browser's own
          // edit is cancelled and the textarea then mirrors what the app made of it (editableText, TextSelectionRange). The app's caret is the one that counts: a tap reaches Compose
          // as a real touch, arrow keys go through the connection as key events. Each key carries the text the textarea would have held: a field with no InputConnection gets that
          // through the semantics SetText action instead, and the Worker records why (snapshot.imeFallback).
          control.spellcheck = false; control.setAttribute('autocomplete', 'off'); control.setAttribute('autocorrect', 'off'); control.setAttribute('autocapitalize', 'off');
          const typing = () => imeServes(owner.ownerViewId);
          const type = op => queueComposeAction(owner.ownerViewId, node.nodeId, 'ime', [op]);
          // Without an input session (semantic pointer mode, or no InputConnection) the caret follows the textarea through SetSelection, as before: only a collapsed caret is sent
          // (a range would put Compose in selection mode, whose floating toolbar needs ActionMode), and not one already where the app has it (`control._caret`).
          const selection = () => {
            if (session !== state.viewSession || !control._actions?.has('SetSelection') || typing()) return;
            const start = control.selectionStart ?? control.value.length, end = control.selectionEnd ?? control.value.length;
            if (start !== end || start === control._caret) return;
            control._caret = start; queueComposeAction(owner.ownerViewId, node.nodeId, 'SetSelection', [start, start, false]);
          };
          control.addEventListener('beforeinput', event => {
            if (session !== state.viewSession || event.isComposing || control._composing) return;
            const op = keyboardOperation(event, typing()); if (!op) return;   // not a key the keyboard sends: the input event below takes the browser's edit
            event.preventDefault(); op.fallbackText = echoEdit(control, op); type(op);
          });
          control.addEventListener('compositionstart', () => { control._composing = true; });
          control.addEventListener('compositionupdate', event => { if (session === state.viewSession && typing()) type({ kind: 'composing', text: String(event.data ?? ''), fallbackText: null }); });
          control.addEventListener('compositionend', event => { control._composing = false; if (session === state.viewSession) type({ kind: 'commit', text: String(event.data ?? ''), fallbackText: control.value }); });
          control.addEventListener('input', event => { if (session === state.viewSession && !event.isComposing && !control._composing && !/Composition/.test(event.inputType ?? '')) { queueComposeAction(owner.ownerViewId, node.nodeId, 'SetText', [control.value]); control._caret = control.value.length; selection(); } });
          control.addEventListener('keydown', event => {   // cursor keys of the keyboard: key events through the connection (Compose moves its caret with its own offset mapping)
            if (session !== state.viewSession || event.isComposing || !typing()) return;
            const code = CURSOR_KEYS[event.key], ctrl = event.ctrlKey || event.metaKey;
            if (code) type({ kind: 'key', code, meta: (event.shiftKey ? META_SHIFT : 0) | (ctrl ? META_CTRL : 0) | (event.altKey ? META_ALT : 0), fallbackText: null });
            else if (ctrl && !event.altKey && event.key.toLowerCase() === 'a') type({ kind: 'selectAll', fallbackText: null });
          });
          control.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) || (event.shiftKey && event.key.startsWith('Arrow'))) selection(); });
          // A click inside the field: with real touches (the default) Compose placed its caret from the touch, on its own layout; only the semantic pointer mode needs SetSelection.
          control.addEventListener('mouseup', () => { if (!pointerClicks()) setTimeout(selection, 0); });
          control.addEventListener('select', () => { if (!pointerClicks()) selection(); });
          control.addEventListener('focus', () => { if (session === state.viewSession && control._actions.has('RequestFocus')) queueComposeAction(owner.ownerViewId, node.nodeId, 'RequestFocus'); });
        } else if (slider) {
          control.type = 'range';   // Slider / SetProgress: dragging or the arrow keys send the semantic SetProgress action
          control.addEventListener('input', () => { if (session === state.viewSession) queueComposeAction(owner.ownerViewId, node.nodeId, 'SetProgress', [Number(control.value)]); });
        } else if (clickable) {
          control.type = 'button'; control.addEventListener('click', event => { event.stopPropagation(); if (pointerClicks() && event.detail > 0) return;   /* a pointer click already reached Compose as MotionEvents; keyboard / assistive activation (detail 0) uses the semantic action */
          if (session === state.viewSession) queueComposeAction(owner.ownerViewId, node.nodeId, control._activation); });
        }
        control.addEventListener('contextmenu', event => {
          if (session === state.viewSession && control._actions.has('OnLongClick') && control.getAttribute('aria-disabled') !== 'true') { event.preventDefault(); event.stopPropagation(); queueComposeAction(owner.ownerViewId, node.nodeId, 'OnLongClick'); }
        });
        control.addEventListener('wheel', event => {
          if (session !== state.viewSession || !control._scrollTarget || control._scrollTarget.disabled) return;
          event.preventDefault(); event.stopPropagation(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? owner.height : 1;
          queueComposeAction(owner.ownerViewId, control._scrollTarget.nodeId, 'ScrollBy', [event.deltaX * unit, event.deltaY * unit]);
        }, { passive: false });
        control.addEventListener('keydown', event => {
          if (editable || event.target !== control || !control._scrollTarget || control._scrollTarget.disabled || !['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)) return;
          event.preventDefault(); const distance = event.key.startsWith('Page') ? owner.height * .8 : 40;
          queueComposeAction(owner.ownerViewId, control._scrollTarget.nodeId, 'ScrollBy', [0, /Up$/.test(event.key) ? -distance : distance]);
        });
        state.composeElements.set(key, control);
      }
      active.add(key); control._actions = actions; control._activation = activation;
      // DOM controls are siblings, but accessibility scrolling must follow the
      // actual Semantics parent chain rather than the browser's page scroll.
      let scrollTarget = node; const scrollSeen = new Set();
      while (scrollTarget && !scrollSeen.has(scrollTarget.nodeId)) { scrollSeen.add(scrollTarget.nodeId); if (scrollTarget.actions?.some(action => action.name === 'ScrollBy')) break; scrollTarget = byId.get(scrollTarget.parentId); }
      control._scrollTarget = scrollTarget || null; control.dataset.ownerViewId = id; control.dataset.nodeId = String(node.nodeId);
      if (node.testTag) control.dataset.testTag = node.testTag; else delete control.dataset.testTag;
      control.style.cssText = `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.right-b.left}px;height:${b.bottom-b.top}px;box-sizing:border-box;min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:transparent;text-shadow:none;box-shadow:none;resize:none;overflow:hidden;caret-color:transparent;pointer-events:${editable || clickable || scrollable ? 'auto' : 'none'};font:16px sans-serif`;
      const label = texts.join(' · ') || node.testTag || (editable ? 'APK text field' : (node.actions || []).find(action => action.label)?.label) || 'APK action';
      control.setAttribute('aria-label', label); control.setAttribute('aria-disabled', String(!!node.disabled));
      if (editable) {
        const pending = state.composeInFlight === key || state.pendingComposeActions.some(action => action.key === key && (action.action === 'SetText' || action.action === 'ime')) || !!control._composing;
        if (!pending && Array.isArray(node.textSelection)) control._caret = node.textSelection[0] === node.textSelection[1] ? node.textSelection[0] : null;
        // the app moved its caret without changing the text (a key through the connection, a touch): the focused textarea follows it
        if (!pending && document.activeElement === control && control.value === (node.editableText || '') && Array.isArray(node.textSelection) && imeServes(owner.ownerViewId)
          && (control.selectionStart !== node.textSelection[0] || control.selectionEnd !== node.textSelection[1])) { try { control.setSelectionRange(Math.min(node.textSelection[0], control.value.length), Math.min(node.textSelection[1], control.value.length)); } catch { /* detached */ } }
        if (!(document.activeElement === control && pending) && control.value !== (node.editableText || '')) {
          // the app changed the text itself (a mask, a formatter, a reset): keep the caret where the app put it (TextSelectionRange), not at the end the browser would choose
          const text = node.editableText || '', focused = document.activeElement === control, fromEnd = control.value.length - (control.selectionEnd ?? control.value.length);
          control.value = text;
          if (focused) { const [start, end] = Array.isArray(node.textSelection) ? node.textSelection : [Math.max(0, text.length - fromEnd), Math.max(0, text.length - fromEnd)]; try { control.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length)); } catch { /* detached */ } }
        }
        control.disabled = !!node.disabled;
      } else if (slider) {
        const info = node.rangeInfo; control.min = String(info.start); control.max = String(info.end); control.step = info.steps > 0 ? String((info.end - info.start) / (info.steps + 1)) : 'any';
        if (document.activeElement !== control || !state.composeInFlight) control.value = String(info.current);
        control.disabled = !!node.disabled; control.style.pointerEvents = 'none'; /* keyboard / assistive use only: drags reach Compose as MotionEvents */ control.setAttribute('role', 'slider'); control.setAttribute('aria-valuenow', String(info.current)); control.setAttribute('aria-valuemin', String(info.start)); control.setAttribute('aria-valuemax', String(info.end));
      } else {
        control.textContent = texts.join(' '); control.tabIndex = clickable && !node.disabled || scrollable && !node.disabled ? 0 : -1;
        if (clickable) control.disabled = !!node.disabled;
      }
      const role = String(node.role || '').toLowerCase();
      if (editable) { control.removeAttribute('role'); control.removeAttribute('aria-checked'); }
      else if (node.toggleState) { control.setAttribute('role', role.includes('switch') ? 'switch' : 'checkbox'); control.setAttribute('aria-checked', node.toggleState === 'Indeterminate' ? 'mixed' : String(node.toggleState === 'On')); }
      else if (slider) control.removeAttribute('aria-checked');
      else { control.removeAttribute('aria-checked'); if (clickable) control.setAttribute('role', 'button'); else if (!editable) control.removeAttribute('role'); }
      if (node.selected !== null && node.selected !== undefined) control.setAttribute('aria-selected', String(node.selected)); else control.removeAttribute('aria-selected');
      controls.push(control); controlKeys.push(key);
    }
    reconcileChildren(layer, controls);
    if (layer.parentNode !== host) host.append(layer);
    host._semanticsMemo = treeVersion === undefined ? null : { version: treeVersion, session: state.viewSession, layer, controls: new Map(controlKeys.map((key, i) => [key, controls[i]])) };
    if (hasPlacedContent && view.contentRaster.drawCalls > 0) readyOwners++;
  }
  for (const element of state.viewElements.values()) if (element._semanticsLayer && !layers.has(element._semanticsLayer)) element._semanticsLayer.remove();
  for (const [key, control] of state.composeElements) if (!active.has(key)) { control.remove(); state.composeElements.delete(key); }
  return owners.length ? readyOwners === owners.length : null;
}

async function flushPendingInputs() {
  if (state.inputPromise) return state.inputPromise;
  if (state.busy || !state.runtime || !state.pendingInputs.size && !state.pendingFocus.length && !state.pendingComposeActions.length && !state.pendingScrolls.size && !state.pendingPointers.length && !state.pendingScrollBys.size) return;
  const token = state.operation;
  state.inputPromise = (async () => {
    watchInputWait();
    while ((state.pendingInputs.size || state.pendingFocus.length || state.pendingComposeActions.length || state.pendingScrolls.size || state.pendingPointers.length || state.pendingScrollBys.size) && !state.busy && token === state.operation) {
      if (!state.pendingPointers.length && state.pendingScrollBys.size) {
        const [id, delta] = state.pendingScrollBys.entries().next().value; state.pendingScrollBys.delete(id);
        try { const snapshot = await whenVmFree(() => state.runtime.scrollBy(id, delta.dx, delta.dy)); if (token === state.operation) renderSnapshot(snapshot); }
        catch (error) { if (token === state.operation) reportAPKError(error, 'List scrolling interrupted'); state.pendingScrollBys.clear(); break; }
        continue;
      }
      if (state.pendingPointers.length) {
        // Pointer samples keep their order; consecutive MOVEs of the same gesture collapse to the newest while the VM is busy.
        while (state.pendingPointers.length > 1 && state.pendingPointers[0].action === 2 && state.pendingPointers[1].action === 2 && state.pendingPointers[0].ownerViewId === state.pendingPointers[1].ownerViewId) state.pendingPointers.shift();
        const sample = state.pendingPointers.shift(); state.pointerInFlight = sample; (state.pointerLog ??= []).push([sample.action, Math.round(sample.x * 10) / 10, Math.round(sample.y * 10) / 10, sample.ownerViewId]); if (state.pointerLog.length > 12) state.pointerLog.shift();
        try { const snapshot = await whenVmFree(() => state.runtime.pointer(sample)); if (token === state.operation) renderSnapshot(snapshot); }
        catch (error) { if (token === state.operation) reportAPKError(error, 'Pointer input interrupted'); state.pendingPointers.length = 0; break; }
        finally { state.pointerInFlight = null; }
        continue;
      }
      if (state.pendingFocus.length && (state.pendingFocus[0].focused || !state.pendingInputs.size)) { const event = state.pendingFocus.shift(); try { const snapshot = await whenVmFree(() => event.pressed !== undefined ? state.runtime.press(event.id, event.pressed, event.x, event.y) : state.runtime.focus(event.id, event.focused)); if (token === state.operation) renderSnapshot(snapshot); } catch (error) { if (token === state.operation) reportAPKError(error, 'Callback de foco interrompido'); state.pendingFocus.length = 0; state.pendingInputs.clear(); break; } continue; }
      if (!state.pendingInputs.size && state.pendingScrolls.size) {
        const [id, position] = state.pendingScrolls.entries().next().value; state.pendingScrolls.delete(id); state.scrollInFlight = id;
        try {
          const snapshot = await whenVmFree(() => state.runtime.scroll(id, position.x, position.y));
          if (token === state.operation) { state.scrollAcknowledging = id; try { renderSnapshot(snapshot); } finally { state.scrollAcknowledging = null; } }
        } catch (error) { if (token === state.operation) reportAPKError(error, 'Scroll callback interrupted'); state.pendingScrolls.clear(); break; }
        finally { state.scrollInFlight = null; }
        continue;
      }
      if (!state.pendingInputs.size && state.pendingComposeActions.length) {
        const action = state.pendingComposeActions.shift();
        // Bound to the session and overlay element it was created from: a pruned/replaced control or an older session can no longer be targeted.
        if (action.session !== state.viewSession || action.control && state.composeElements.get(action.key) !== action.control) { appendTrace(`Compose action discarded: node ${action.key} is no longer on screen (${action.action}).`); continue; }
        state.composeInFlight = action.key;
        try { const snapshot = action.kind === 'action-item' ? await state.runtime.actionItem(action.modeId, action.itemId) : action.action === 'ime' ? await state.runtime.ime(action.ownerViewId, action.nodeId, action.args) : await state.runtime.composeAction(action.ownerViewId, action.nodeId, action.action, action.args); state.composeInFlight = null; /* its own reply is no longer pending: the field mirrors it */ if (token === state.operation) renderSnapshot(snapshot); }
        catch (error) {
          if (error?.details?.kind === 'compose-semantics-stale-node') { appendTrace(`Compose action discarded by the VM: ${error.message}`); continue; }
          if (token === state.operation) reportAPKError(error, 'Compose accessibility action interrupted'); state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); break; }
        finally { state.composeInFlight = null; }
        continue;
      }
      const [id, text] = state.pendingInputs.entries().next().value; state.pendingInputs.delete(id); state.inputInFlight = id;
      try { const snapshot = await state.runtime.input(id, text); if (token === state.operation) renderSnapshot(snapshot); }
      catch (error) { if (token === state.operation) reportAPKError(error, 'Text callback interrupted'); state.pendingInputs.clear(); break; }
      finally { state.inputInFlight = null; }
    }
  })().finally(() => { state.inputPromise = null; stopInputWait(); });
  return state.inputPromise;
}
/**
 * While the page waits for the VM to answer an input (a tap, a key, a scroll), the device shows that it is working instead of looking frozen: a thin bar along the top of the
 * screen and the seconds since the VM last answered, once that passes INPUT_WAIT_SHOW_MS. Each answer (renderSnapshot) restarts the count, so a gesture that gets its frames does
 * not show it. The VM itself cannot draw while the app's code holds its main thread (a long onClick, a new screen's first composition, first-time class loading): on a device that
 * takes milliseconds, here it can take seconds; the app's own frames follow as soon as it lets go. The last VM signal (heartbeat) names what it is doing, in the bar's title.
 */
const INPUT_WAIT_SHOW_MS = 350;
let inputWaitTimer = null, inputWaitStart = 0;
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();
function inputWaitElement() {
  const screen = document.getElementById('android-screen'); if (!screen) return null;
  let bar = document.getElementById('input-wait');
  if (!bar) { bar = document.createElement('div'); bar.id = 'input-wait'; bar.className = 'input-wait'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite'); bar.hidden = true; bar.innerHTML = '<i aria-hidden="true"></i><span></span>'; screen.append(bar); }
  return bar;
}
function watchInputWait() {
  stopInputWait(); inputWaitStart = nowMs();
  inputWaitTimer = setInterval(() => {
    const bar = inputWaitElement(); if (!bar) return;
    const waited = nowMs() - Math.max(inputWaitStart, state.lastSnapshotAt ?? 0);
    if (waited < INPUT_WAIT_SHOW_MS) { bar.hidden = true; return; }
    const beat = state.runtime?.lastHeartbeat, doing = beat?.hostCall ?? beat?.stack?.[0] ?? null;
    bar.querySelector('span').textContent = `Working… ${(waited / 1000).toFixed(1)} s`;
    bar.title = doing ? `The app is running: ${doing}` : 'The app is running';
    bar.hidden = false;
  }, 100);
}
function stopInputWait() { if (inputWaitTimer !== null) clearInterval(inputWaitTimer); inputWaitTimer = null; const bar = document.getElementById?.('input-wait'); if (bar) bar.hidden = true; }
async function checkView(id, checked) {
  if (!state.runtime || state.busy) return;
  await flushPendingInputs(); const token = beginOperation('Updating option in the DEX…');
  try { const snapshot = await state.runtime.check(id, checked); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Option callback interrupted'); }
  finally { finishOperation(token); }
}
const inAndroidWindow = element => $('android-content').contains(element) || $('android-window-layer').contains(element);
// Bottom-to-top WindowManager order is the snapshot order. A modal window gets a pointer-blocking scrim; its opacity is the real FLAG_DIM_BEHIND dimAmount.
function renderWindowSurfaces(surfaces) {
  const layer = $('android-window-layer'), seen = new Set(), ordered = [];
  for (const view of surfaces) {
    const window = view.windowSurface, id = String(window.id);
    if (!Number.isFinite(window.id) || !['x', 'y', 'width', 'height', 'dimAmount'].every(name => Number.isFinite(window[name]))) throw new Error('The VM returned an invalid Android window.');
    seen.add(id); let entry = state.windowSurfaceElements.get(id);
    if (!entry) {
      entry = { scrim: document.createElement('div'), box: document.createElement('div'), rootId: view.id }; entry.scrim.className = 'android-window-scrim'; entry.box.className = 'android-window-surface'; state.windowSurfaceElements.set(id, entry);
      // A touch on the scrim of a popup window is a touch outside it: the window gets it as real MotionEvents with coordinates outside its bounds (a PopupWindow or a Compose
      // Popup dismisses itself on it when it is meant to). Dialog windows keep the scrim as a plain blocker.
      const session = state.viewSession, owner = entry;
      for (const [name, action] of [['pointerdown', 0], ['pointerup', 1], ['pointercancel', 3]]) owner.scrim.addEventListener(name, event => {
        if (session !== state.viewSession || !state.runtime || state.lastAPKError || owner.box.dataset.windowKind !== 'popup' || event.button > 0 || state.pendingPointers.length >= 512) return;
        if (action === 0) owner.outsidePointer = event.pointerId; else if (owner.outsidePointer !== event.pointerId) return; else owner.outsidePointer = null;
        const rect = owner.box.getBoundingClientRect(), scale = rect.width / (owner.box.offsetWidth || rect.width || 1) || 1;
        state.pendingPointers.push({ ownerViewId: owner.rootId, action, x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale, t: event.timeStamp, outside: true });
        flushPendingInputs();
      });
    }
    entry.rootId = view.id;
    entry.scrim.hidden = window.visible === false || !window.modal; entry.scrim.style.background = `rgba(0,0,0,${Math.max(0, Math.min(1, window.dimAmount))})`; entry.scrim.dataset.windowId = id;
    entry.box.hidden = window.visible === false; entry.box.dataset.windowId = id; entry.box.dataset.windowKind = String(window.kind); entry.box.dataset.modal = String(!!window.modal); entry.box.dataset.focused = String(!!window.focused);
    entry.box.style.left = `${window.x}px`; entry.box.style.top = `${window.y}px`; entry.box.style.width = `${window.width}px`; entry.box.style.height = `${window.height}px`;
    reconcileChildren(entry.box, [createView(view)]); ordered.push(entry.scrim, entry.box);
  }
  for (const id of [...state.windowSurfaceElements.keys()]) if (!seen.has(id)) state.windowSurfaceElements.delete(id);
  reconcileChildren(layer, ordered);
}
// Floating action-mode toolbars (ActionMode.TYPE_FLOATING): the VM decides when a toolbar shows, its items (visible and enabled, in FloatingToolbar order) and the content rect it
// points at; the page lays it out the way LocalFloatingToolbarPopup does (main-panel items that fit, the rest behind the overflow button; above the content rect, else below)
// over the originating View's element, and sends a click on an item back to the VM, which performs MenuBuilder.performItemAction. Nothing here finishes the mode: the app does.
function actionModeLayer() {
  let layer = $('android-action-mode-layer');
  if (!layer?.isConnected) {   // the player frame's $ answers a detached stub for an id it does not have
    const windows = $('android-window-layer'); if (!windows?.isConnected || !windows.parentNode) return null;
    layer = document.createElement('div'); layer.id = 'android-action-mode-layer'; layer.className = 'android-action-mode-layer';
    layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:5';
    windows.parentNode.insertBefore(layer, windows.nextSibling);
  }
  return layer;
}
function queueActionItem(modeId, itemId) {
  if (!state.runtime || state.lastAPKError) return;
  if (state.pendingComposeActions.length >= 128) { reportAPKError(new Error('The action queue exceeded 128 events; reopen the APK.'), 'Input queue interrupted'); return; }
  state.pendingComposeActions.push({ kind: 'action-item', key: `action-mode:${modeId}:${itemId}`, modeId, itemId, session: state.viewSession, action: 'ActionItem' });
  flushPendingInputs();
}
const TOOLBAR_STYLE = 'position:absolute;pointer-events:auto;background:#fff;border-radius:8px;box-shadow:0 2px 6px #0004;z-index:1';
function toolbarButton(mode, item, metrics, padStart, padEnd, vertical, session) {
  const element = document.createElement('button'); element.type = 'button'; element.textContent = item.title; element.dataset.itemId = String(item.itemId);
  if (item.contentDescription) element.setAttribute('aria-label', item.contentDescription);
  element.style.cssText = `display:block;box-sizing:border-box;margin:0;border:0;background:transparent;color:#1f1f1f;font:500 ${metrics.textSize}px AndroidRoboto,Roboto,sans-serif;white-space:nowrap;cursor:pointer;height:${metrics.lineHeight}px;min-width:${metrics.buttonMinimumWidth}px;padding:0 ${padEnd}px 0 ${padStart}px;${vertical ? 'width:100%;text-align:start' : ''}`;
  element.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });   // the focus (and the IME) stays where the app has it
  element.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (session === state.viewSession) queueActionItem(mode.id, item.id); });
  return element;
}
/** LocalFloatingToolbarPopup.layoutMainPanelItems: the first item always, later ones while they fit beside the overflow button (or fit outright as the last), never one that requires the overflow. */
function layoutToolbar(toolbar, layer, mode, viewport) {
  const m = mode.metrics, session = state.viewSession, panel = document.createElement('div'), overflow = document.createElement('div');
  toolbar.replaceChildren(); toolbar._overflowOpen = false;
  panel.className = 'android-floating-toolbar-main'; panel.style.cssText = 'display:flex;flex-direction:row;align-items:center';
  toolbar.append(panel); if (toolbar.parentNode !== layer) layer.append(toolbar);
  const toolbarWidth = Math.min(m.preferredWidth, Math.max(0, viewport.right - viewport.left - 2 * m.marginHorizontal)); let available = toolbarWidth, index = 0;
  for (; index < mode.items.length; index++) {
    const item = mode.items[index], first = index === 0, last = index === mode.items.length - 1;
    if (!first && item.requiresOverflow) break;
    const element = toolbarButton(mode, item, m, Math.trunc(first ? 1.5 * m.buttonSidePadding : m.buttonSidePadding), Math.trunc(last ? 1.5 * m.buttonSidePadding : m.buttonSidePadding), false, session); panel.append(element);
    const itemWidth = Math.min(element.offsetWidth, toolbarWidth);
    if (itemWidth <= available - m.overflowButtonWidth || (last && itemWidth <= available)) available -= itemWidth; else { element.remove(); break; }
  }
  if (index >= mode.items.length) return;
  const more = document.createElement('button'); more.type = 'button'; more.textContent = '⋮'; more.setAttribute('aria-label', 'More options'); more.setAttribute('aria-expanded', 'false');
  more.style.cssText = `display:block;box-sizing:border-box;margin:0;border:0;background:transparent;color:#1f1f1f;font:700 18px sans-serif;cursor:pointer;width:${m.overflowButtonWidth}px;height:${m.lineHeight}px;padding:0`;
  more.addEventListener('pointerdown', event => { event.preventDefault(); event.stopPropagation(); });
  more.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toolbar._overflowOpen = !toolbar._overflowOpen; overflow.hidden = !toolbar._overflowOpen; more.setAttribute('aria-expanded', String(toolbar._overflowOpen)); toolbar._place?.(); });
  panel.append(more);
  overflow.className = 'android-floating-toolbar-overflow'; overflow.hidden = true;
  overflow.style.cssText = `position:absolute;left:0;min-width:100%;background:#fff;border-radius:8px;box-shadow:0 2px 6px #0004;padding:4px 0;max-height:${Math.max(m.minimumOverflowHeight, viewport.bottom - viewport.top - 2 * m.marginVertical)}px;overflow:auto`;
  for (const item of mode.items.slice(index)) overflow.append(toolbarButton(mode, item, m, 16, 16, true, session));
  toolbar.append(overflow);
}
function renderActionModes(modes = []) {
  const layer = actionModeLayer(); if (!layer) return;
  const screen = layer.parentNode, screenRect = screen.getBoundingClientRect(), scale = screenRect.width / (screen.offsetWidth || screenRect.width) || 1;
  const width = screen.offsetWidth || screenRect.width / scale, height = screen.offsetHeight || screenRect.height / scale, toolbars = [];
  for (const mode of Array.isArray(modes) ? modes : []) {
    const origin = state.viewElements.get(String(mode.originViewId));
    if (mode.type !== 'floating' || !origin || !inAndroidWindow(origin) || !Array.isArray(mode.items) || !mode.items.length) continue;
    if (![...mode.contentRect, ...mode.viewport, ...mode.viewLocation, ...mode.windowLocation].every(Number.isFinite)) throw new Error('The VM returned an invalid action bar.');
    // VM screen pixels -> this screen element: the originating View's element is where the VM says the View is
    const box = origin.getBoundingClientRect(), dx = (box.left - screenRect.left) / scale - mode.viewLocation[0], dy = (box.top - screenRect.top) / scale - mode.viewLocation[1];
    const m = mode.metrics, content = { left: mode.contentRect[0] + dx, top: mode.contentRect[1] + dy, right: mode.contentRect[2] + dx, bottom: mode.contentRect[3] + dy };
    const viewport = { left: Math.max(0, mode.viewport[0] + dx), top: Math.max(0, mode.viewport[1] + dy), right: Math.min(width, mode.viewport[2] + dx), bottom: Math.min(height, mode.viewport[3] + dy) };
    let toolbar = [...layer.children].find(child => child.dataset.actionMode === String(mode.id));
    if (!toolbar) { toolbar = document.createElement('div'); toolbar.dataset.actionMode = String(mode.id); toolbar.className = 'android-floating-toolbar'; toolbar.setAttribute('role', 'toolbar'); }
    toolbar.style.cssText = TOOLBAR_STYLE;
    const signature = JSON.stringify([mode.items, m, Math.round(viewport.right - viewport.left), state.viewSession]);
    if (toolbar._signature !== signature) { toolbar._signature = signature; layoutToolbar(toolbar, layer, mode, viewport); }
    else if (toolbar.parentNode !== layer) layer.append(toolbar);
    // LocalFloatingToolbarPopup.refreshCoordinatesAndOverflowDirection (main panel): above the content rect when it fits with its margins, else below, else below without the margin, else as high as the view port allows
    toolbar._place = () => {
      const w = toolbar.firstElementChild?.offsetWidth || 0, lineWithMargin = m.lineHeight + 2 * m.marginVertical;
      const above = content.top - viewport.top, below = viewport.bottom - content.bottom;
      const y = above >= lineWithMargin ? content.top - lineWithMargin : below >= lineWithMargin ? content.bottom : below >= m.lineHeight ? content.bottom - m.marginVertical : Math.max(viewport.top, content.top - lineWithMargin);
      const x = Math.min((content.left + content.right) / 2 - w / 2, viewport.right - w), left = Math.max(mode.windowLocation[0] + dx, x), top = Math.max(mode.windowLocation[1] + dy, y) + m.marginVertical;
      toolbar.style.left = `${Math.round(left)}px`; toolbar.style.top = `${Math.round(top)}px`;
      const overflow = toolbar.querySelector('.android-floating-toolbar-overflow');
      if (overflow && !overflow.hidden) { const down = viewport.bottom - (top + m.lineHeight) >= Math.min(overflow.scrollHeight, m.minimumOverflowHeight) || top - viewport.top < viewport.bottom - top; overflow.style.top = down ? `${m.lineHeight}px` : ''; overflow.style.bottom = down ? '' : `${m.lineHeight}px`; }
    };
    toolbar._place(); toolbars.push(toolbar);
  }
  reconcileChildren(layer, toolbars);
}
function renderSnapshot(snapshot) {
  const meter = ctx.frameMeter?.enabled ? ctx.frameMeter : null, meterAt = meter ? nowMs() : 0, putBefore = runtimeFrames.putMs;   // "Show frame rate": the page's own draw time of this frame
  state.lastSnapshotAt = nowMs();   // the input wait indicator (watchInputWait) counts from the VM's last answer
  if (runtimeFrames.pending && state.runtime?.ackFrame) state.runtime.ackFrame(runtimeFrames.seq);   // an RPC reply replaces a queued scheduled-event snapshot: it counts as drawn
  runtimeFrames.pending = null; runtimeFrames.rendered++; if (runtimeFrames.drawn.length < 50000) runtimeFrames.drawn.push(Date.now());
  if (snapshot && 'ime' in snapshot) state.imeState = snapshot.ime;
  if (snapshot?.droppedComposeAction) appendTrace(`Compose action discarded: node ${snapshot.droppedComposeAction.ownerViewId}:${snapshot.droppedComposeAction.nodeId} no longer exists (${snapshot.droppedComposeAction.action}).`);
  if (!state.stickyError) state.lastAPKError = null;
  state.canGoBack = !!snapshot.canGoBack; hooks.navigationChanged?.(state.canGoBack);
  if (snapshot.closed) {
    $('android-action-mode-layer')?.replaceChildren();
    state.apkRunning = false; hideError();   // the device stays: its launcher shows the app (hooks.closed)
    updateTrace(snapshot); hooks.closed?.(snapshot); return;
  }
  if (!Array.isArray(snapshot?.views) || !snapshot.views.length) throw new Error('The Activity ran without producing a supported Android Views interface. See the execution log.');
  // Roots registered through the real WindowManager (windowSurface) are layered above the Activity window; the DOM invents no dialog UI.
  const surfaces = snapshot.views.filter(view => view.windowSurface);
  liveShadowKeys = new Set();
  reconcileChildren($('android-content'), snapshot.views.filter(view => !view.windowSurface).map(view => createView(view)));
  renderWindowSurfaces(surfaces);
  webviews?.sweep(webViewIds(snapshot.views));
  renderSystemBars(snapshot.systemBars);
  // PhoneWindow background from the Activity theme (android:windowBackground, resolved by the VM through the real theme).
  { const content = $('android-content'), background = snapshot.views.find(view => !view.windowSurface)?.windowBackground; content.style.background = ''; content.style.backgroundColor = '#fff'; content.style.backgroundImage = '';
    if (background?.kind === 'color') { const a = background.argb >>> 0; content.style.backgroundColor = `rgba(${(a >>> 16) & 255},${(a >>> 8) & 255},${a & 255},${(a >>> 24) / 255})`; }
    else if (background?.kind === 'drawable') { const drawing = background.drawing; let url; if (drawing.kind === 'raster') { url = drawing.dataURL; if (!pngURLOk(url)) throw new Error('Invalid window background raster.'); } else { const svg = drawing.svg; if (typeof svg !== 'string' || svg.length > 2 * 1024 * 1024 || !svg.trimStart().startsWith('<svg')) throw new Error('Invalid window background vector.'); url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; } content.style.backgroundImage = `url("${url}")`; content.style.backgroundSize = '100% 100%'; content.style.backgroundRepeat = 'no-repeat'; } }
  for (const key of [...state.shadowElements.keys()]) if (!liveShadowKeys.has(key)) state.shadowElements.delete(key);
  renderNativeCanvasOverlays(snapshot.views);
  syncNativeScroll(snapshot.views);
  const semanticsStarted = nowMs(), composeReady = renderComposeSemantics(snapshot); runtimeFrames.semanticsMs += nowMs() - semanticsStarted;
  renderActionModes(snapshot.actionModes);
  $('android-content').inert = surfaces.some(view => view.windowSurface.modal && view.windowSurface.visible !== false); $('android-window-layer').inert = false;
  $('android-content').style.padding = '0';
  state.apkRunning = true; $('android-device').hidden = state.mode !== 'apk'; $('android-device').inert = state.mode !== 'apk'; if (!state.stickyError) hideError();   // a background thread's failure stays on screen (onThreadFailure)
  hooks.rendered?.(snapshot, composeReady);
  updateTrace(snapshot);
  // after the VM trace replaced the log: a key the Worker could not send through an InputConnection (its own trace has the WEB InputMethod line too)
  if (snapshot.imeFallback) { const f = snapshot.imeFallback; state.imeFallbacks = (state.imeFallbacks ?? 0) + 1; appendTrace(`Keyboard: ${f.keys} key(s) without an InputConnection (${f.reason}); ${f.via === 'SetText' ? 'used the SetText action with the field text' : 'key discarded'}.`); }
  notifyParent('apk-lab-snapshot', { activityName: snapshot.activityName, texts: snapshot.texts, counters: snapshot.counters });
  if (meter) meter.frame(snapshot, { at: meterAt, drawMs: nowMs() - meterAt, putMs: runtimeFrames.putMs - putBefore });
}
return { resetWebViews: () => webviews?.reset(), renderSnapshot, createView, queueComposeAction, flushPendingInputs, bindVM, runtimeFrames, renderSystemBars, updateSystemBarIcons, fitDevice, startClock };
}
