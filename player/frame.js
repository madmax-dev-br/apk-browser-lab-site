// Entry of dist/player/frame.html: device frame + system bars + rendering, driven by postMessage from the embedding page.
import { APKWorkerClient } from '../apk-worker-client.js?v=a104526a388b';
import { createDeviceView, createViewState } from '../device-view.js?v=a104526a388b';
import { createGlSurfaces } from '../gl-surfaces.js?v=a104526a388b';
import { sanitizeSettings } from '../device-settings.js?v=a104526a388b';
import { createFrameController } from './frame-controller.js?v=a104526a388b';
import { validateHostMessage, envelope, REVISION, CAPABILITIES } from './protocol.js?v=a104526a388b';
import { createPluginHost } from '../plugin-host.js?v=a104526a388b';
import { captureImage } from '../screen-capture.js?v=a104526a388b';
import { layoutBoundsRects, drawLayoutBounds } from '../layout-bounds.js?v=a104526a388b';
import { PERMISSION_ICONS } from '../permissions-panel.js?v=a104526a388b';
import { createSandboxedWorkerFactory } from './plugin-sandbox.js?v=a104526a388b';

const parentOrigin = new URLSearchParams(location.search).get('parent');
const $ = id => document.getElementById(id) ?? (frameStub[id] ??= Object.assign(document.createElement('div'), { id }));
const frameStub = {};
const status = message => { const element = document.getElementById('player-status'); if (!element) return; element.textContent = message || ''; element.hidden = !message; };
const state = { mode: 'apk', runtime: null, inventory: null, apkRunning: false, canGoBack: false, busy: false, operation: 0, lastAPKError: null, ...createViewState() };
const query = new URLSearchParams(location.search);
// ?scale=actual keeps the emulated screen at 1 CSS px per dp (pixel comparisons, screenshots); the default fits the device to the frame.
// ?raster=full replays every frame at full density (measurement); the default replays moving frames at a reduced scale and refines the settled screen (src/motion-raster.js).
const deviceState = { settings: sanitizeSettings({}), clockTimer: null, pointerClicks: query.get('pointerClicks') === 'real' ? true : query.get('pointerClicks') === 'semantic' ? false : undefined, maxScale: query.get('scale') === 'actual' ? 1 : 4, stagePadding: 8, motionRaster: query.get('raster') !== 'full' };
const vm = new APKWorkerClient();
const glSurfaces = createGlSurfaces();   // OpenGL ES window surfaces of the app (src/gles-native.js): their frames drawn in the SurfaceView's box
vm.onGlFrame = frame => glSurfaces.frame(frame);
setTimeout(() => vm.prewarm?.(), 0);   // the VM Worker fetches and compiles the lab's assets while the page sends (and the frame downloads) the APK (src/apk-worker-client.js prewarm)
let lastReport = '';
// Copy the shared plain-text report. Clipboard API first (needs permission in some embeds), then execCommand, then the report is shown selected for Cmd/Ctrl+C.
document.getElementById('player-error-copy')?.addEventListener('click', async event => {
  const button = event.currentTarget, pre = document.getElementById('player-error-report'); let copied = false;
  try { await navigator.clipboard.writeText(lastReport); copied = true; } catch { /* permission policy of the embedding page */ }
  if (!copied) { pre.textContent = lastReport; pre.hidden = false; const range = document.createRange(); range.selectNodeContents(pre); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); try { copied = document.execCommand('copy'); } catch { /* selection stays for manual copy */ } }
  button.textContent = copied ? 'Diagnóstico copiado' : 'Selecionado: copie com Ctrl/Cmd+C';
  setTimeout(() => { button.textContent = 'Copiar diagnóstico'; }, 2500);
});
const post = message => { if (window.parent !== window && parentOrigin) window.parent.postMessage(message, parentOrigin); };
const getHost = id => state.viewElements.get(String(id)) ?? null;
// "Mostrar limites de layout" (layoutBounds config): the lab's overlay, redrawn only when a frame is drawn or the option changes (as src/app.js redrawLayoutBounds).
function redrawLayoutBounds(snapshot, settings) {
  const canvas = document.getElementById('layout-bounds-canvas'); if (!canvas) return;
  const on = !!settings?.layoutBounds && !!snapshot; canvas.hidden = !on; if (!on) return;
  const screen = document.getElementById('android-screen'), frame = deviceState.bars?.contentFrame, width = screen?.clientWidth || deviceState.bars?.widthDp || 411, height = screen?.clientHeight || deviceState.bars?.heightDp || 914;
  drawLayoutBounds(canvas, layoutBoundsRects(snapshot, { origin: { x: frame?.left ?? 0, y: frame?.top ?? 0 } }), width, height);
}
// permissionDialog: 'frame': the lab's own permission dialog over the phone screen (markup of src/index.html, rules of src/runtime-permissions.js applied by the controller).
const shortPermission = name => String(name).replace(/^android\.permission\./, '').replace(/^com\.android\./, '');
function permissionDialog(request) {
  return new Promise(resolve => {
    const scrim = document.getElementById('permission-dialog'); if (!scrim || !request.dialogs.length) { resolve(null); return; }
    const content = $('android-content'), layer = $('android-window-layer'), before = { content: content.inert, layer: layer.inert }, focusBack = document.activeElement, answers = [];
    content.inert = true; layer.inert = true;
    const button = id => document.getElementById(id);
    const close = value => { scrim.hidden = true; scrim.onkeydown = null; for (const id of ['perm-allow', 'perm-once', 'perm-deny']) if (button(id)) button(id).onclick = null; content.inert = before.content; layer.inert = before.layer; try { focusBack?.focus?.(); } catch { /* gone */ } resolve(value); };
    const show = index => {
      const dialog = request.dialogs[index];
      scrim.classList.toggle('dark', !!deviceState.settings.darkTheme);
      button('perm-question').textContent = dialog.question; button('perm-detail').textContent = dialog.permissions.map(shortPermission).join(', ');
      button('perm-icon').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PERMISSION_ICONS[dialog.group] ?? PERMISSION_ICONS.OTHER}"/></svg>`;
      button('perm-allow').textContent = dialog.oneTime ? 'Enquanto o app está em uso' : 'Permitir'; button('perm-once').hidden = !dialog.oneTime;
      const answer = choice => { answers.push(choice); if (index + 1 < request.dialogs.length) show(index + 1); else close(answers); };
      button('perm-allow').onclick = () => answer('allow'); button('perm-once').onclick = () => answer('once'); button('perm-deny').onclick = () => answer('deny');
      scrim.onkeydown = event => {
        if (event.key === 'Escape') { event.preventDefault(); close(null); return; }   // dismissed
        if (event.key !== 'Tab') return;
        const buttons = ['perm-allow', 'perm-once', 'perm-deny'].map(button).filter(item => item && !item.hidden), first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      scrim.hidden = false; button('perm-allow').focus();
    };
    show(0);
  });
}
// Plugins sent by the host page run in Workers of an opaque origin (src/player/plugin-sandbox.js); their lab API is the lab page's (src/plugin-host.js).
let sandboxedWorkers = null;
const pluginHostFactory = callbacks => createPluginHost({ ...callbacks, vm, createWorker: name => (sandboxedWorkers ??= createSandboxedWorkerFactory())(name), captureImage: request => captureImage({ ...request, getHost }) });
const controller = createFrameController({ vm, state, deviceState, post, createPluginHost: pluginHostFactory, captureImage: request => captureImage({ ...request, getHost }), hooks: {
  rendered: redrawLayoutBounds,
  permissionDialog,
  error(info) {
    lastReport = info.report ?? info.message;
    document.getElementById('player-error-title').textContent = info.kind; document.getElementById('player-error-message').textContent = info.cause ?? info.message;
    document.getElementById('player-error-report').hidden = true; document.getElementById('player-error-copy').textContent = 'Copiar diagnóstico';
    document.getElementById('player-error').hidden = false; status('');
  },
  cleared() { document.getElementById('player-error').hidden = true; status('Loading the APK…'); },   // a stop says so right after (stopped)
  stopped() { document.getElementById('android-device').hidden = true; status('The VM is stopped. Restart opens the app again.'); },
  interrupted() { $('android-content').inert = true; $('android-window-layer').inert = true; },
  settingsChanged() { view.updateSystemBarIcons(); },
  destroyed() { document.getElementById('android-device').hidden = true; status(''); },
} });
const view = createDeviceView({ $, state, deviceState, hideError() { document.getElementById('player-error').hidden = true; }, appendTrace() {}, updateTrace() {}, notifyParent() {},
  reportAPKError: (error, title) => controller.operations.reportAPKError(error, title), beginOperation: () => controller.operations.beginOperation(), finishOperation: token => controller.operations.finishOperation(token),
  clickView: id => controller.operations.clickView(id),
  hooks: { glSurface: (element, info) => glSurfaces.bind(element, info), navigationChanged: value => controller.operations.navigationChanged(value), closed: snapshot => { status('Activity stack is empty.'); controller.operations.closed(snapshot); }, rendered: snapshot => { status(''); lastPendingDelay = snapshot.pendingEventDelay ?? null; lastHealth = snapshot.vmHealth; lastRenderAt = performance.now(); lastReduced = snapshot.rasterReduced === true; controller.operations.snapshotRendered(snapshot); } } });
controller.attach(view); view.bindVM(vm);
let lastPendingDelay = null, lastRenderAt = 0, lastHealth = null, lastReduced = false;   // the VM's next scheduled event (see apk-worker currentSnapshot): a near event means the screen is about to change; lastReduced: the frame shown is a reduced-scale replay, the full-density one is still to come
// The host element can change size without the iframe window being resized by anything else (CSS, containers): refit the device, never relaunch the VM.
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (deviceState.bars) view.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); }).observe(document.getElementById('preview-stage'));

window.addEventListener('message', event => {
  // Only the embedding window, only from the origin it declared in ?parent=, only well-formed versioned messages.
  if (event.source !== window.parent || !parentOrigin || event.origin !== parentOrigin) return;
  const result = validateHostMessage(event.data);
  if (!result.ok) { post(envelope('error', { kind: 'protocol', message: result.error, phase: 'message', frontier: null })); return; }
  if (result.message.type === 'init') status('Loading the APK…');
  controller.handle(result.message);
});
// Frame hidden or closing: store the app data right away (only has an effect when the page opted in with keep-data).
document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') vm.flushAppData(); }); globalThis.addEventListener?.('pagehide', () => vm.flushAppData());
if (!parentOrigin || parentOrigin === 'null') status('Missing or opaque ?parent= origin: this frame only runs inside <apk-player>.');
else post(envelope('hello', { revision: REVISION, capabilities: [...CAPABILITIES] }));

// Read-only introspection for automated checks (scripts/validation/browser-driver.mjs): true when no VM request, queued input or frame is in flight. idle() also waits for the full-density replay of a frame shown at reduced scale.
window.__apkPlayer = { debugRequest: (type, payload) => vm.request(type, payload, { timeoutMs: 300000 }), inputsDrained: () => !state.busy && !controller.inflight && !state.pendingClicks && !state.inputPromise && !state.inputInFlight && !state.composeInFlight && !state.pointerInFlight && !state.pendingInputs.size && !state.pendingFocus.length && !state.pendingComposeActions.length && !state.pendingScrolls.size && !state.pendingPointers.length && !state.pendingScrollBys.size, idle: () => !lastReduced && (lastPendingDelay === null || performance.now() - lastRenderAt >= Math.min(lastPendingDelay + 40, 120)) && !view.runtimeFrames.vmBusy && !state.busy && !controller.inflight && !state.pendingClicks && !state.inputPromise && !state.inputInFlight && !state.pendingInputs.size && !state.pendingFocus.length && !state.pendingComposeActions.length && !state.pendingScrolls.size && !state.pendingPointers.length && !state.pendingScrollBys.size && !state.composeInFlight && !view.runtimeFrames.requested && !view.runtimeFrames.pending, running: () => state.apkRunning, debug: () => ({ pendingClicks: state.pendingClicks ?? 0, rasterReduced: lastReduced, reducedDrawn: view.runtimeFrames.reducedDrawn, droppedCount: controller.dropped.length, dropped: controller.dropped.slice(-3), health: lastHealth, vmBusy: view.runtimeFrames.vmBusy, sinceRender: Math.round(performance.now() - lastRenderAt), rendered: view.runtimeFrames.rendered, coalesced: view.runtimeFrames.coalesced, drawMs: view.runtimeFrames.drawMs, putMs: view.runtimeFrames.putMs, frameLog: view.runtimeFrames.log, drawLog: view.runtimeFrames.drawn, pendingDelay: lastPendingDelay, frames: { requested: view.runtimeFrames.requested, pending: !!view.runtimeFrames.pending }, pendingPointers: state.pendingPointers.length, pointerInFlight: state.pointerInFlight ?? null, pointerLog: state.pointerLog ?? [], busy: state.busy, lastError: state.lastAPKError ? String(state.lastAPKError.error?.message).slice(0, 300) : null }) };
