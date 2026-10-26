// Shared Android device renderer: Views/Compose/WindowManager snapshot -> DOM, input forwarding, system bars. Used verbatim by the lab page (app.js)
// and by the embeddable player frame (player/frame.js); each supplies the page-specific chrome through `hooks`.
import { isTrustedRasterURL } from './raster-cache.js?v=e9d35ddef77e';
/** Per-instance render state (DOM element maps and pending input queues) shared with the host page's own `state` object. */
export function createViewState() {
  return { viewElements: new Map(), shadowElements: new Map(), windowSurfaceElements: new Map(), viewSession: 0, pendingInputs: new Map(), pendingFocus: [], inputPromise: null, inputInFlight: null, pendingComposeActions: [], composeElements: new Map(), nativeOverlayElements: new Map(), composeInFlight: null, pendingScrolls: new Map(), scrollInFlight: null, scrollAcknowledging: null };
}
/**
 * ctx: { $ (id lookup), state, deviceState ({settings, bars, clockTimer}), hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, clickView, notifyParent, hooks }
 * hooks: navigationChanged(canGoBack), closed(snapshot), rendered(snapshot, composeReady).
 */
export function createDeviceView(ctx) {
const { $, state, deviceState, hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, notifyParent, hooks = {} } = ctx, clickView = id => ctx.clickView(id);
// VM timer events (animations, handlers) can arrive faster than the display refreshes: only the newest is rendered, once per frame. An RPC result
// (renderSnapshot called directly) is always newer than a queued event, so renderSnapshot clears the queue.
const runtimeFrames = { pending: null, requested: false, coalesced: 0, rendered: 0 };
const nextFrame = globalThis.requestAnimationFrame ? callback => globalThis.requestAnimationFrame(callback) : callback => setTimeout(callback, 16);
function flushRuntimeSnapshot(vm) {
  runtimeFrames.requested = false; const snapshot = runtimeFrames.pending; runtimeFrames.pending = null;
  if (!snapshot || state.runtime !== vm) return;
  try { renderSnapshot(snapshot); } catch (error) { reportAPKError(error, 'Falha ao renderizar callback da VM'); }
}
/** Route the Worker client's asynchronous snapshots/errors (timers, animations) into this view. */
function bindVM(vm) {
  vm.onRuntimeSnapshot = snapshot => {
    if (state.runtime !== vm) return;
    if (runtimeFrames.pending) runtimeFrames.coalesced++;
    runtimeFrames.pending = snapshot; if (!runtimeFrames.requested) { runtimeFrames.requested = true; nextFrame(() => flushRuntimeSnapshot(vm)); }
  };
  vm.onRuntimeError = error => { if (state.runtime === vm) reportAPKError(error, 'Callback assíncrono interrompido'); };
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
      if (view.transformMatrix) { const m = view.transformMatrix; if (!Array.isArray(m) || m.length !== 9 || m.some(value => !Number.isFinite(value)) || m[6] !== 0 || m[7] !== 0 || m[8] !== 1) throw new Error('Matriz inválida na sobreposição AndroidView.'); element.style.transformOrigin = '0 0'; element.style.transform = `matrix(${m[0]},${m[3]},${m[1]},${m[4]},${m[2]},${m[5]})`; }
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
  const available = { w: Math.max(120, stage.clientWidth - (deviceState.stagePadding ?? 24)), h: Math.max(160, stage.clientHeight - (deviceState.stagePadding ? deviceState.stagePadding / 2 : 16)) }, scale = Math.min(deviceState.maxScale ?? 0.7, available.w / (widthDp + 10), available.h / (heightDp + 10));
  device.style.setProperty('--screen-w', String(widthDp)); device.style.setProperty('--screen-h', String(heightDp)); device.style.setProperty('--scale', scale.toFixed(4));
}
function renderSystemBars(bars) {
  const device = $('android-device'); if (!device || !bars) return; deviceState.bars = bars;
  fitDevice(bars.widthDp, bars.heightDp);
  const status = $('sysbar-status'), nav = $('sysbar-nav'), content = $('android-content');
  device.style.setProperty('--status-h', String(bars.status.height)); device.style.setProperty('--nav-h', String(bars.nav.thickness));
  status.hidden = !bars.status.visible; status.style.setProperty('--sb-bg', argbToCSS(bars.status.color)); device.style.setProperty('--sb-fg', bars.status.light ? '#1b1b1f' : '#ffffff'); device.style.setProperty('--sb-bg', argbToCSS(bars.status.color));
  nav.hidden = !bars.nav.visible; nav.classList.toggle('buttons', bars.nav.mode === 'buttons'); nav.classList.toggle('side-right', bars.nav.side === 'right'); device.style.setProperty('--nav-bg', argbToCSS(bars.nav.color)); device.style.setProperty('--nav-fg', bars.nav.light ? '#1b1b1f' : '#ffffff');
  const frame = bars.contentFrame; Object.assign(content.style, { left: `${frame.left}px`, top: `${frame.top}px`, width: `${frame.right - frame.left}px`, height: `${frame.bottom - frame.top}px` });
  if (!deviceState.clockTimer) startClock(); else updateSystemBarIcons();
}

let liveShadowKeys = new Set();
function shadowElement(child) {
  const shadow = child.shadow, key = String(child.id); if (shadow) liveShadowKeys.add(key);
  if (!shadow) { state.shadowElements.delete(key); return null; }
  if (!child.bounds || !['z', 'margin', 'width', 'height'].every(name => Number.isFinite(shadow[name])) || shadow.width <= 0 || shadow.height <= 0 || !pngURLOk(shadow.dataURL)) throw new Error('Sombra de View inválida recebida da VM.');
  let element = state.shadowElements.get(key);
  if (!element) { element = document.createElement('img'); element.className = 'android-view-shadow'; element.alt = ''; element.draggable = false; element.setAttribute('aria-hidden', 'true'); state.shadowElements.set(key, element); }
  if (element.src !== shadow.dataURL) element.src = shadow.dataURL;
  element.dataset.viewId = key; element.dataset.z = String(shadow.z);
  const shadowCSS = `position:absolute;left:${child.bounds.left - shadow.margin}px;top:${child.bounds.top - shadow.margin}px;width:${shadow.width}px;height:${shadow.height}px;max-width:none;pointer-events:none;user-select:none`;
  if (element._css !== shadowCSS) { element.style.cssText = shadowCSS; element._css = shadowCSS; }
  return element;
}
const SIGNATURE_SKIP = new Set(['children']);
function viewSignature(view, parentKind, parentLaidOut, clipOwnBounds, renderChildren, focusBusy) {
  return `${parentKind}|${parentLaidOut}|${clipOwnBounds}|${renderChildren}|${focusBusy}|${state.viewSession}|${JSON.stringify(view, (key, value) => SIGNATURE_SKIP.has(key) ? undefined : value)}`;
}
function createView(view, parentKind = '', parentLaidOut = false, clipOwnBounds = false, renderChildren = true) {
  if (!view || typeof view !== 'object') throw new Error('A VM retornou uma árvore de interface inválida.');
  const kind = view.kind, key = String(view.id);
  let element = state.viewElements.get(key);
  if (element?.dataset.kind !== kind) element = null;
  if (!element) {
    const session = state.viewSession;
    if (kind === 'button') { element = document.createElement('button'); element.type = 'button'; element.addEventListener('click', () => { if (element._session === state.viewSession) clickView(view.id); }); }
    else if (kind === 'input') { element = document.createElement('input'); element.type = 'text'; for (const event of ['focus', 'blur']) element.addEventListener(event, () => { if (session !== state.viewSession) return; if (state.pendingFocus.length >= 128) { reportAPKError(new Error('A fila de foco excedeu 128 eventos; reabra o APK.'), 'Fila de foco interrompida'); return; } state.pendingFocus.push({ id: view.id, focused: event === 'focus' }); flushPendingInputs(); }); element.addEventListener('input', () => { if (session !== state.viewSession) return; state.pendingInputs.set(view.id, element.value); flushPendingInputs(); }); }
    else if (kind === 'check') { element = document.createElement('label'); element._control = document.createElement('input'); element._control.type = 'checkbox'; element._label = document.createElement('span'); element.append(element._control, element._label); element._control.addEventListener('change', () => { if (element._session === state.viewSession) checkView(view.id, element._control.checked); }); }
    else if (kind === 'progress') element = document.createElement('progress');
    else if (['linear', 'frame', 'scroll', 'text', 'image', 'group', 'view'].includes(kind)) { element = document.createElement('div'); if (kind === 'text' || kind === 'image' || kind === 'view') { element.addEventListener('click', () => { if (element._session === state.viewSession && element.dataset.clickable === 'true') clickView(view.id); }); element.addEventListener('keydown', (event) => { if (element._session === state.viewSession && element.dataset.clickable === 'true' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); clickView(view.id); } }); } }
    else throw new Error(`Tipo de interface não suportado pelo renderizador: ${view.type || kind}.`);
    // Touch/pointer down presses the View (drawable state + StateListAnimator elevation); up/cancel/leave releases it.
    if (kind === 'button' || kind === 'check') for (const [event, pressed] of [['pointerdown', true], ['pointerup', false], ['pointercancel', false], ['pointerleave', false]]) element.addEventListener(event, () => {
      if (session !== state.viewSession || element._pressed === pressed || element.disabled) return; element._pressed = pressed;
      if (state.pendingFocus.length >= 128) return; state.pendingFocus.push({ id: view.id, pressed }); flushPendingInputs();
    });
    if (kind === 'scroll') element.addEventListener('scroll', () => {
      if (session !== state.viewSession || !state.runtime || state.lastAPKError) return;
      const x = Math.round(element.scrollLeft), y = Math.round(element.scrollTop);
      if (element._vmScroll?.x === x && element._vmScroll?.y === y) return;
      if (!state.pendingScrolls.has(view.id) && state.pendingScrolls.size >= 128) { reportAPKError(new Error('A fila de rolagem excedeu 128 Views.'), 'Fila de rolagem interrompida'); return; }
      state.pendingScrolls.set(view.id, { x, y }); flushPendingInputs();
    });
    element.className = `android-view android-${kind}`; element.dataset.kind = kind; element.dataset.viewId = key; element._session = state.viewSession; state.viewElements.set(key, element);
  }
  // Own-properties pass (attributes/style/rasters of this View): skipped when nothing the VM reported for this View, its render context or its DOM focus changed.
  const focused = document.activeElement === element, signature = viewSignature(view, parentKind, parentLaidOut, clipOwnBounds, renderChildren, focused && (state.pendingInputs.has(view.id) || state.inputInFlight === view.id));
  if (element._signature !== signature) {
  if (kind === 'button' || kind === 'text') element.textContent = view.displayText ?? view.text ?? '';
  if (kind === 'button') element.disabled = view.clickable === false || view.enabled === false;
  if (kind === 'text' || kind === 'image' || kind === 'view') { element.dataset.clickable = String(!!view.clickable && view.enabled !== false); element.tabIndex = view.clickable && view.enabled !== false ? 0 : -1; if (view.clickable) element.setAttribute('role', 'button'); else element.removeAttribute('role'); }
  if (kind === 'button' || view.clickable && ['text','view'].includes(kind)) element.setAttribute('aria-label', view.contentDescription || view.displayText || view.text || `Ação ${view.androidId || view.id}`);
  if (kind === 'image') { element.setAttribute('role', view.clickable ? 'button' : 'img'); element.setAttribute('aria-label', view.contentDescription || 'Imagem do APK'); }
  if (kind === 'input') { if (!(focused && (state.pendingInputs.has(view.id) || state.inputInFlight === view.id)) && element.value !== (view.text ?? '')) element.value = view.text ?? ''; element.readOnly = !!view.readOnly; element.placeholder = view.hint || ''; element.setAttribute('aria-label', view.contentDescription || view.hint || `Campo ${view.androidId || view.id}`); element.disabled = view.enabled === false; element.inputMode = (view.inputType & 15) === 2 ? 'decimal' : 'text'; }
  if (kind === 'check') { element._control.checked = !!view.checked; element._control.disabled = view.enabled === false; element._control.setAttribute('aria-label', view.text || 'Opção'); element._label.textContent = view.text || ''; element.classList.toggle('android-switch', view.type?.includes('/Switch;') && !view.switchWidget); element.classList.toggle('android-switch-vm', !!view.switchWidget); }
  if (kind === 'progress') { element.max = view.max ?? 100; if (view.indeterminate) element.removeAttribute('value'); else element.value = view.progress || 0; }
  element.style.cssText = '';
  // ViewGroup.clipChildren clips each child's RenderNode to its own bounds.
  if (clipOwnBounds) element.style.clipPath = 'inset(0)';
  if (Number.isFinite(view.renderAlpha)) element.style.opacity = String(view.renderAlpha);
  if (view.transformMatrix) { const m = view.transformMatrix; if (!Array.isArray(m) || m.length !== 9 || m.some(value => !Number.isFinite(value)) || m[6] !== 0 || m[7] !== 0 || m[8] !== 1) throw new Error('Invalid planar View transformation'); element.style.transformOrigin = '0 0'; element.style.transform = `matrix(${m[0]},${m[3]},${m[1]},${m[4]},${m[2]},${m[5]})`; }
  if (view.defaultFocusHighlightEnabled === false) element.style.outline = 'none';
  if (kind === 'linear') element.style.flexDirection = view.orientation === 'horizontal' ? 'row' : 'column';
  if (view.laidOut && view.bounds) { element.style.width = `${view.bounds.right - view.bounds.left}px`; element.style.height = `${view.bounds.bottom - view.bounds.top}px`; if (parentLaidOut) { element.style.position = 'absolute'; element.style.left = `${view.bounds.left}px`; element.style.top = `${view.bounds.top}px`; } }
  if (Number.isFinite(view.textLineHeight) && view.textLineHeight > 0) { element.style.lineHeight = `${view.textLineHeight}px`; element.style.fontFamily = 'AndroidSkiaRoboto, AndroidRoboto, sans-serif'; element.style.fontKerning = 'none'; }
  if (view.laidOut && ['group', 'frame', 'linear', 'scroll'].includes(kind)) element.style.position = parentLaidOut ? 'absolute' : 'relative';
  if (Number.isFinite(view.textSize) && view.textSize > 0) element.style.fontSize = `${Math.min(200, view.textSize)}px`;
  if (view.padding) element.style.padding = `${view.padding.top || 0}px ${view.padding.right || 0}px ${view.padding.bottom || 0}px ${view.padding.left || 0}px`;
  // A VM-drawn Switch (thumb/track rasterized with the background) reserves its width through TextView compound padding; the native input only receives input.
  if (kind === 'check' && view.switchWidget && view.compoundPadding) element.style.padding = `${view.compoundPadding.top || 0}px ${view.compoundPadding.right || 0}px ${view.compoundPadding.bottom || 0}px ${view.compoundPadding.left || 0}px`;
  if (view.margin && !(view.laidOut && parentLaidOut)) element.style.margin = `${view.margin.top || 0}px ${view.margin.right || 0}px ${view.margin.bottom || 0}px ${view.margin.left || 0}px`;
  if (!view.laidOut && Number.isFinite(view.layoutWidth)) element.style.width = view.layoutWidth === -1 ? '100%' : view.layoutWidth === -2 ? 'max-content' : `${view.layoutWidth}px`;
  if (!view.laidOut && Number.isFinite(view.layoutHeight)) { if (view.layoutHeight >= 0) element.style.height = `${view.layoutHeight}px`; else if (view.layoutHeight === -1) element.style.height = '100%'; }
  if (view.weight > 0) { element.style.flexGrow = String(view.weight); element.style.flexShrink = '1'; element.style.flexBasis = '0'; }
  if (Number.isFinite(view.textFontWeight)) { element.style.fontFamily = 'AndroidSkiaRoboto, AndroidRoboto, sans-serif'; element.style.fontWeight = String(view.textFontWeight); element.style.fontStyle = view.textFontItalic ? 'italic' : 'normal'; }
  if (view.textStyle & 1) element.style.fontWeight = '700'; if (view.textStyle & 2) element.style.fontStyle = 'italic';
  if (view.textAllCaps !== undefined) element.style.textTransform = view.textAllCaps ? 'uppercase' : 'none';
  if (kind === 'progress') { const tint = cssColor(view.progressTint) || '#009688'; element.style.setProperty('--android-progress-color', tint); element.style.accentColor = tint; }
  if (kind === 'scroll') { element.style.overflow = 'auto'; element.style.overscrollBehavior = 'contain'; }
  if (kind === 'scroll' && view.fillViewport) element.dataset.fillViewport = 'true'; else delete element.dataset.fillViewport;
  if (view.textColor) element.style.color = cssColor(view.textColor);
  if (view.background) element.style.background = cssColor(view.background);
  if (view.drawableSVG) {
    const drawing = view.drawableSVG; let url;
    if (drawing.kind === 'raster') { url = drawing.dataURL; if (!pngURLOk(url)) throw new Error('Raster PNG inválido ou excessivo recebido da VM.'); }
    else { const svg = typeof drawing === 'string' ? drawing : drawing.svg; if (typeof svg !== 'string' || svg.length > 2 * 1024 * 1024 || !svg.trimStart().startsWith('<svg')) throw new Error('Estado de desenho vetorial inválido ou excessivo.'); url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
    element.style.backgroundImage = `url("${url}")`; element.style.backgroundRepeat = 'no-repeat'; element.style.backgroundSize = '100% 100%';
  }
  // The VM owns geometry: the page stylesheet's 48px minimums/web borders must not alter laid-out bounds, and a
  // VM-drawn background Drawable (original ripple/inset/9-patch DEX) replaces the web control's own decoration.
  if (view.laidOut && view.bounds) { element.style.minHeight = '0'; element.style.minWidth = '0'; }
  if (view.drawableSVG && ['input', 'button'].includes(kind)) { element.style.border = '0'; element.style.borderRadius = '0'; element.style.boxShadow = 'none'; element.style.backgroundColor = 'transparent'; }
  if (view.textRaster && ['text', 'button'].includes(kind)) {
    const drawing = view.textRaster;
    if (!pngURLOk(drawing.dataURL) || !Number.isFinite(drawing.width) || !Number.isFinite(drawing.height)) throw new Error('PNG de parágrafo inválido recebido da VM.');
    const image = `url("${drawing.dataURL}")`, size = `${drawing.width}px ${drawing.height}px`, position = `${view.padding?.left || 0}px ${view.padding?.top || 0}px`;
    element.style.backgroundImage = element.style.backgroundImage ? `${image}, ${element.style.backgroundImage}` : image;
    element.style.backgroundSize = view.drawableSVG ? `${size}, 100% 100%` : size;
    element.style.backgroundPosition = view.drawableSVG ? `${position}, 0 0` : position;
    element.style.backgroundRepeat = 'no-repeat'; element.style.color = 'transparent'; element.style.textShadow = 'none';
  }
  const gravity = view.gravity > 0 ? view.gravity : 0;
  if (gravity & 1) { element.style.textAlign = 'center'; if (kind === 'linear') element.style.alignItems = 'center'; }
  if ((gravity & 7) === 5) { element.style.textAlign = 'right'; if (kind === 'linear') element.style.alignItems = 'flex-end'; }
  if ((gravity & 0x70) === 0x10 && kind === 'linear') element.style.justifyContent = 'center';
  if ((gravity & 0x70) === 0x50 && kind === 'linear') element.style.justifyContent = 'flex-end';
  const layoutGravity = view.layoutGravity > 0 ? view.layoutGravity : 0;
  if (parentKind === 'frame' && !(view.laidOut && parentLaidOut)) { element.style.alignSelf = (layoutGravity & 0x70) === 0x50 ? 'end' : (layoutGravity & 0x70) === 0x10 ? 'center' : 'start'; element.style.justifySelf = (layoutGravity & 7) === 5 ? 'end' : (layoutGravity & 7) === 1 ? 'center' : 'start'; }
  else if (layoutGravity && !(view.laidOut && parentLaidOut)) { element.style.alignSelf = (layoutGravity & 7) === 5 ? 'flex-end' : (layoutGravity & 1) ? 'center' : 'flex-start'; element.style.justifySelf = (layoutGravity & 7) === 5 ? 'end' : (layoutGravity & 1) ? 'center' : 'start'; }
  if (view.visibility === 8) element.style.display = 'none'; else if (view.visibility === 4) element.style.visibility = 'hidden';
  if (view.enabled === false) element.setAttribute('aria-disabled', 'true'); else element.removeAttribute('aria-disabled');
  element._signature = signature;
  }
  if (['linear', 'frame', 'scroll', 'group'].includes(kind)) {
    element.dataset.clickable = String(!!view.clickable && view.enabled !== false);
    if (view.clickable) { element.setAttribute('role', 'button'); element.tabIndex = view.enabled !== false ? 0 : -1; } else { element.removeAttribute('role'); element.removeAttribute('tabindex'); }
    if (!element._groupClickInstalled) {
      element._groupClickInstalled = true;
      element.addEventListener('click', event => { if (element.dataset.clickable !== 'true' || element._session !== state.viewSession) return; const control = event.target.closest('button,input,[data-kind="check"],[data-clickable="true"]'); if (control && control !== element) return; event.stopPropagation(); clickView(view.id); });
      element.addEventListener('keydown', event => { if (event.target === element && element._session === state.viewSession && element.dataset.clickable === 'true' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); clickView(view.id); } });
    }
    // A child with Z>0 has its Skia shadow raster drawn by the parent, beneath the child and before its content (HWUI order).
    const children = view.canvasChildrenCaptured || !renderChildren ? [] : (view.children || []).flatMap(child => { const body = createView(child, kind, !!view.laidOut, view.clipChildren !== false), shadow = shadowElement(child); return shadow ? [shadow, body] : [body]; });
    const padding = view.padding || {};
    if (kind !== 'scroll' && view.laidOut && view.clipToPadding !== false && Object.values(padding).some(value => value > 0)) {
      // dispatchDraw clips only children, preserving the parent's background.
      const layer = element._childLayer ||= document.createElement('div');
      layer.className = 'android-child-layer'; layer.style.cssText = `position:absolute;inset:0;clip-path:inset(${padding.top || 0}px ${padding.right || 0}px ${padding.bottom || 0}px ${padding.left || 0}px)`;
      reconcileChildren(layer, children); reconcileChildren(element, [layer, element._contentLayer, element._foregroundLayer, element._semanticsLayer, element._nativeOverlayLayer, !renderChildren ? element._nativeClip : null].filter(Boolean));
    } else reconcileChildren(element, [...children, element._contentLayer, element._foregroundLayer, element._semanticsLayer, element._nativeOverlayLayer, !renderChildren ? element._nativeClip : null].filter(Boolean));
  }
  if (view.canvasChildrenCaptured && !view.contentRaster) throw new Error('A captura Canvas não retornou uma imagem de conteúdo.');
  if (view.contentRaster) {
    if (kind === 'input' || kind === 'progress') throw new Error('Canvas sobre controle HTML exige um contêiner.');
    const drawing = view.contentRaster, layer = element._contentLayer ||= document.createElement('img');
    if (drawing.kind !== 'raster' || !pngURLOk(drawing.dataURL) || !(drawing.width > 0 && drawing.height > 0)) throw new Error('PNG de conteúdo Canvas inválido recebido da VM.');
    if (layer._url !== drawing.dataURL) { layer.src = drawing.dataURL; layer._url = drawing.dataURL; layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.className = 'android-canvas-content'; layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0'; }
    if (!element.style.position) element.style.position = 'relative';
    if (layer.parentNode !== element) element.append(layer);
  } else element._contentLayer?.remove();
  if (view.foregroundSVG) {
    if (kind === 'input' || kind === 'progress') throw new Error('Foreground sobre este controle nativo HTML exige um contêiner de desenho.');
    const drawing = view.foregroundSVG, layer = element._foregroundLayer ||= document.createElement('img');
    let url;
    if (drawing.kind === 'raster') { url = drawing.dataURL; if (!pngURLOk(url)) throw new Error('PNG de foreground inválido recebido da VM.'); }
    else { const svg = typeof drawing === 'string' ? drawing : drawing.svg; if (typeof svg !== 'string' || svg.length > 2 * 1024 * 1024 || !svg.trimStart().startsWith('<svg')) throw new Error('SVG de foreground inválido recebido da VM.'); url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; }
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
  const key = `${ownerViewId}:${nodeId}`, entry = { key, ownerViewId, nodeId, action, args, session: state.viewSession, control: state.composeElements.get(key) };
  const last = state.pendingComposeActions.at(-1);
  // Coalesce only adjacent text replacements; a click remains ordered after
  // every preceding edit, including edits entered while an RPC is in flight.
  if (action === 'SetText' && last?.key === key && last.action === action) last.args = args;
  else if (state.pendingComposeActions.length < 128) state.pendingComposeActions.push(entry);
  else { reportAPKError(new Error('A fila de ações Compose excedeu 128 eventos; reabra o APK.'), 'Fila de acessibilidade interrompida'); return; }
  flushPendingInputs();
}
function renderComposeSemantics(snapshot) {
  if (!document.getElementById('compose-accessibility-style')) {
    const style = document.createElement('style'); style.id = 'compose-accessibility-style';
    style.textContent = '.compose-semantic-control:focus-visible{outline:2px solid #315ce8;outline-offset:-2px}.compose-semantic-control::selection{background:transparent;color:transparent}';
    document.head.append(style);
  }
  const owners = snapshot.composeSemantics?.owners || [], views = new Map(), active = new Set(), layers = new Set();
  const visit = view => { views.set(String(view.id), view); for (const child of view.children || []) visit(child); };
  snapshot.views.forEach(visit);
  let readyOwners = 0;
  for (const owner of owners) {
    const id = String(owner.ownerViewId), view = views.get(id), host = state.viewElements.get(id);
    if (!owner.attached || !view?.contentRaster || !view.canvasChildrenCaptured || !host || !inAndroidWindow(host)) continue;
    const nodes = owner.nodes || [];
    if (nodes.length > 4096) throw new Error('Árvore de acessibilidade Compose excessiva.');
    const byId = new Map(nodes.map(node => [node.nodeId, node]));
    const visible = node => { const seen = new Set(); while (node) { if (node.invisibleToUser || seen.has(node.nodeId)) return false; seen.add(node.nodeId); node = byId.get(node.parentId); } return true; };
    const layer = host._semanticsLayer ||= document.createElement('div');
    layer.className = 'compose-semantics-layer'; layer.style.cssText = 'position:absolute;inset:0;padding:0;margin:0;pointer-events:none;overflow:hidden;z-index:2';
    layers.add(layer); const controls = []; let hasPlacedContent = false;
    for (const node of nodes) {
      const b = node.boundsInRoot;
      if (!visible(node) || !node.placed || !b || ![b.left,b.top,b.right,b.bottom].every(Number.isFinite) || b.right <= 0 || b.bottom <= 0 || b.left >= owner.width || b.top >= owner.height) continue;
      const actions = new Set((node.actions || []).map(action => action.name)), texts = [...(node.contentDescriptions || []), ...(node.texts || [])].filter(value => typeof value === 'string' && value.length);
      const editable = actions.has('SetText'), activation = ['OnClick', 'Dismiss', 'Expand', 'Collapse'].find(action => actions.has(action)), clickable = !!activation, scrollable = actions.has('ScrollBy');
      if (!editable && !clickable && !scrollable && !texts.length) continue;
      hasPlacedContent = true;
      const key = `${owner.ownerViewId}:${node.nodeId}`, kind = editable ? 'input' : clickable ? 'button' : 'text';
      let control = state.composeElements.get(key);
      if (control?.dataset.controlKind !== kind) control = null;
      if (!control) {
        control = document.createElement(editable ? 'textarea' : clickable ? 'button' : 'div');
        control.dataset.controlKind = kind; control.className = 'compose-semantic-control';
        const session = state.viewSession;
        control.addEventListener('click', event => event.stopPropagation());
        if (editable) {
          control.addEventListener('input', () => { if (session === state.viewSession) queueComposeAction(owner.ownerViewId, node.nodeId, 'SetText', [control.value]); });
          control.addEventListener('focus', () => { if (session === state.viewSession && control._actions.has('RequestFocus')) queueComposeAction(owner.ownerViewId, node.nodeId, 'RequestFocus'); });
        } else if (clickable) {
          control.type = 'button'; control.addEventListener('click', event => { event.stopPropagation(); if (session === state.viewSession) queueComposeAction(owner.ownerViewId, node.nodeId, control._activation); });
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
      const label = texts.join(' · ') || node.testTag || (editable ? 'Campo de texto do APK' : (node.actions || []).find(action => action.label)?.label) || 'Ação do APK';
      control.setAttribute('aria-label', label); control.setAttribute('aria-disabled', String(!!node.disabled));
      if (editable) {
        const pending = state.composeInFlight === key || state.pendingComposeActions.some(action => action.key === key && action.action === 'SetText');
        if (!(document.activeElement === control && pending) && control.value !== (node.editableText || '')) control.value = node.editableText || '';
        control.disabled = !!node.disabled;
      } else {
        control.textContent = texts.join(' '); control.tabIndex = clickable && !node.disabled || scrollable && !node.disabled ? 0 : -1;
        if (clickable) control.disabled = !!node.disabled;
      }
      const role = String(node.role || '').toLowerCase();
      if (editable) { control.removeAttribute('role'); control.removeAttribute('aria-checked'); }
      else if (node.toggleState) { control.setAttribute('role', role.includes('switch') ? 'switch' : 'checkbox'); control.setAttribute('aria-checked', node.toggleState === 'Indeterminate' ? 'mixed' : String(node.toggleState === 'On')); }
      else { control.removeAttribute('aria-checked'); if (clickable) control.setAttribute('role', 'button'); else if (!editable) control.removeAttribute('role'); }
      if (node.selected !== null && node.selected !== undefined) control.setAttribute('aria-selected', String(node.selected)); else control.removeAttribute('aria-selected');
      controls.push(control);
    }
    reconcileChildren(layer, controls);
    if (layer.parentNode !== host) host.append(layer);
    if (hasPlacedContent && view.contentRaster.drawCalls > 0) readyOwners++;
  }
  for (const element of state.viewElements.values()) if (element._semanticsLayer && !layers.has(element._semanticsLayer)) element._semanticsLayer.remove();
  for (const [key, control] of state.composeElements) if (!active.has(key)) { control.remove(); state.composeElements.delete(key); }
  return owners.length ? readyOwners === owners.length : null;
}

async function flushPendingInputs() {
  if (state.inputPromise) return state.inputPromise;
  if (state.busy || !state.runtime || !state.pendingInputs.size && !state.pendingFocus.length && !state.pendingComposeActions.length && !state.pendingScrolls.size) return;
  const token = state.operation;
  state.inputPromise = (async () => {
    while ((state.pendingInputs.size || state.pendingFocus.length || state.pendingComposeActions.length || state.pendingScrolls.size) && !state.busy && token === state.operation) {
      if (state.pendingFocus.length && (state.pendingFocus[0].focused || !state.pendingInputs.size)) { const event = state.pendingFocus.shift(); try { const snapshot = event.pressed !== undefined ? await state.runtime.press(event.id, event.pressed) : await state.runtime.focus(event.id, event.focused); if (token === state.operation) renderSnapshot(snapshot); } catch (error) { if (token === state.operation) reportAPKError(error, 'Callback de foco interrompido'); state.pendingFocus.length = 0; state.pendingInputs.clear(); break; } continue; }
      if (!state.pendingInputs.size && state.pendingScrolls.size) {
        const [id, position] = state.pendingScrolls.entries().next().value; state.pendingScrolls.delete(id); state.scrollInFlight = id;
        try {
          const snapshot = await state.runtime.scroll(id, position.x, position.y);
          if (token === state.operation) { state.scrollAcknowledging = id; try { renderSnapshot(snapshot); } finally { state.scrollAcknowledging = null; } }
        } catch (error) { if (token === state.operation) reportAPKError(error, 'Callback de rolagem interrompido'); state.pendingScrolls.clear(); break; }
        finally { state.scrollInFlight = null; }
        continue;
      }
      if (!state.pendingInputs.size && state.pendingComposeActions.length) {
        const action = state.pendingComposeActions.shift();
        // Bound to the session and overlay element it was created from: a pruned/replaced control or an older session can no longer be targeted.
        if (action.session !== state.viewSession || action.control && state.composeElements.get(action.key) !== action.control) { appendTrace(`Ação Compose descartada: o nó ${action.key} não está mais na tela (${action.action}).`); continue; }
        state.composeInFlight = action.key;
        try { const snapshot = await state.runtime.composeAction(action.ownerViewId, action.nodeId, action.action, action.args); if (token === state.operation) renderSnapshot(snapshot); }
        catch (error) {
          if (error?.details?.kind === 'compose-semantics-stale-node') { appendTrace(`Ação Compose descartada pela VM: ${error.message}`); continue; }
          if (token === state.operation) reportAPKError(error, 'Ação de acessibilidade Compose interrompida'); state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); break; }
        finally { state.composeInFlight = null; }
        continue;
      }
      const [id, text] = state.pendingInputs.entries().next().value; state.pendingInputs.delete(id); state.inputInFlight = id;
      try { const snapshot = await state.runtime.input(id, text); if (token === state.operation) renderSnapshot(snapshot); }
      catch (error) { if (token === state.operation) reportAPKError(error, 'Callback de texto interrompido'); state.pendingInputs.clear(); break; }
      finally { state.inputInFlight = null; }
    }
  })().finally(() => { state.inputPromise = null; });
  return state.inputPromise;
}
async function checkView(id, checked) {
  if (!state.runtime || state.busy) return;
  await flushPendingInputs(); const token = beginOperation('Atualizando opção no DEX…');
  try { const snapshot = await state.runtime.check(id, checked); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Callback de opção interrompido'); }
  finally { finishOperation(token); }
}
const inAndroidWindow = element => $('android-content').contains(element) || $('android-window-layer').contains(element);
// Bottom-to-top WindowManager order is the snapshot order. A modal window gets a pointer-blocking scrim; its opacity is the real FLAG_DIM_BEHIND dimAmount.
function renderWindowSurfaces(surfaces) {
  const layer = $('android-window-layer'), seen = new Set(), ordered = [];
  for (const view of surfaces) {
    const window = view.windowSurface, id = String(window.id);
    if (!Number.isFinite(window.id) || !['x', 'y', 'width', 'height', 'dimAmount'].every(name => Number.isFinite(window[name]))) throw new Error('A VM retornou uma janela Android inválida.');
    seen.add(id); let entry = state.windowSurfaceElements.get(id);
    if (!entry) { entry = { scrim: document.createElement('div'), box: document.createElement('div') }; entry.scrim.className = 'android-window-scrim'; entry.box.className = 'android-window-surface'; state.windowSurfaceElements.set(id, entry); }
    entry.scrim.hidden = window.visible === false || !window.modal; entry.scrim.style.background = `rgba(0,0,0,${Math.max(0, Math.min(1, window.dimAmount))})`; entry.scrim.dataset.windowId = id;
    entry.box.hidden = window.visible === false; entry.box.dataset.windowId = id; entry.box.dataset.windowKind = String(window.kind); entry.box.dataset.modal = String(!!window.modal); entry.box.dataset.focused = String(!!window.focused);
    entry.box.style.left = `${window.x}px`; entry.box.style.top = `${window.y}px`; entry.box.style.width = `${window.width}px`; entry.box.style.height = `${window.height}px`;
    reconcileChildren(entry.box, [createView(view)]); ordered.push(entry.scrim, entry.box);
  }
  for (const id of [...state.windowSurfaceElements.keys()]) if (!seen.has(id)) state.windowSurfaceElements.delete(id);
  reconcileChildren(layer, ordered);
}
function renderSnapshot(snapshot) {
  runtimeFrames.pending = null; runtimeFrames.rendered++;
  if (snapshot?.droppedComposeAction) appendTrace(`Ação Compose descartada: nó ${snapshot.droppedComposeAction.ownerViewId}:${snapshot.droppedComposeAction.nodeId} não existe mais (${snapshot.droppedComposeAction.action}).`);
  state.lastAPKError = null; state.canGoBack = !!snapshot.canGoBack; hooks.navigationChanged?.(state.canGoBack);
  if (snapshot.closed) {
    state.apkRunning = false; $('android-device').hidden = true; hideError();
    updateTrace(snapshot); hooks.closed?.(snapshot); return;
  }
  if (!Array.isArray(snapshot?.views) || !snapshot.views.length) throw new Error('A Activity executou sem produzir uma interface Android Views suportada. Consulte o log de execução.');
  // Roots registered through the real WindowManager (windowSurface) are layered above the Activity window; the DOM invents no dialog UI.
  const surfaces = snapshot.views.filter(view => view.windowSurface);
  liveShadowKeys = new Set();
  reconcileChildren($('android-content'), snapshot.views.filter(view => !view.windowSurface).map(view => createView(view)));
  renderWindowSurfaces(surfaces);
  renderSystemBars(snapshot.systemBars);
  // PhoneWindow background from the Activity theme (android:windowBackground, resolved by the VM through the real theme).
  { const content = $('android-content'), background = snapshot.views.find(view => !view.windowSurface)?.windowBackground; content.style.background = ''; content.style.backgroundColor = '#fff'; content.style.backgroundImage = '';
    if (background?.kind === 'color') { const a = background.argb >>> 0; content.style.backgroundColor = `rgba(${(a >>> 16) & 255},${(a >>> 8) & 255},${a & 255},${(a >>> 24) / 255})`; }
    else if (background?.kind === 'drawable') { const drawing = background.drawing; let url; if (drawing.kind === 'raster') { url = drawing.dataURL; if (!pngURLOk(url)) throw new Error('Window background raster inválido.'); } else { const svg = drawing.svg; if (typeof svg !== 'string' || svg.length > 2 * 1024 * 1024 || !svg.trimStart().startsWith('<svg')) throw new Error('Window background vetorial inválido.'); url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; } content.style.backgroundImage = `url("${url}")`; content.style.backgroundSize = '100% 100%'; content.style.backgroundRepeat = 'no-repeat'; } }
  for (const key of [...state.shadowElements.keys()]) if (!liveShadowKeys.has(key)) state.shadowElements.delete(key);
  renderNativeCanvasOverlays(snapshot.views);
  syncNativeScroll(snapshot.views);
  const composeReady = renderComposeSemantics(snapshot);
  $('android-content').inert = surfaces.some(view => view.windowSurface.modal && view.windowSurface.visible !== false); $('android-window-layer').inert = false;
  $('android-content').style.padding = '0';
  state.apkRunning = true; $('android-device').hidden = state.mode !== 'apk'; $('android-device').inert = state.mode !== 'apk'; hideError();
  hooks.rendered?.(snapshot, composeReady);
  updateTrace(snapshot);
  notifyParent('apk-lab-snapshot', { activityName: snapshot.activityName, texts: snapshot.texts, counters: snapshot.counters });
}
return { renderSnapshot, createView, queueComposeAction, flushPendingInputs, bindVM, runtimeFrames, renderSystemBars, updateSystemBarIcons, fitDevice, startClock };
}
