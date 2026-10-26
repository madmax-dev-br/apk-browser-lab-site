// Entry of dist/player/frame.html: device frame + system bars + rendering, driven by postMessage from the embedding page.
import { APKWorkerClient } from '../apk-worker-client.js?v=38ea11051357';
import { createDeviceView, createViewState } from '../device-view.js?v=38ea11051357';
import { sanitizeSettings } from '../device-settings.js?v=38ea11051357';
import { createFrameController } from './frame-controller.js?v=38ea11051357';
import { validateHostMessage, envelope } from './protocol.js?v=38ea11051357';

const parentOrigin = new URLSearchParams(location.search).get('parent');
const $ = id => document.getElementById(id) ?? (frameStub[id] ??= Object.assign(document.createElement('div'), { id }));
const frameStub = {};
const status = message => { const element = document.getElementById('player-status'); if (!element) return; element.textContent = message || ''; element.hidden = !message; };
const state = { mode: 'apk', runtime: null, inventory: null, apkRunning: false, canGoBack: false, busy: false, operation: 0, lastAPKError: null, ...createViewState() };
const query = new URLSearchParams(location.search);
// ?scale=actual keeps the emulated screen at 1 CSS px per dp (pixel comparisons, screenshots); the default fits the device to the frame.
const deviceState = { settings: sanitizeSettings({}), clockTimer: null, maxScale: query.get('scale') === 'actual' ? 1 : 4, stagePadding: 8 };
const vm = new APKWorkerClient();
const post = message => { if (window.parent !== window && parentOrigin) window.parent.postMessage(message, parentOrigin); };
const controller = createFrameController({ vm, state, deviceState, post, hooks: {
  error(info) { const box = document.getElementById('player-error'); document.getElementById('player-error-title').textContent = info.kind; document.getElementById('player-error-message').textContent = info.message; box.hidden = false; status(''); },
  interrupted() { $('android-content').inert = true; $('android-window-layer').inert = true; },
  settingsChanged() { view.updateSystemBarIcons(); },
  destroyed() { document.getElementById('android-device').hidden = true; status(''); },
} });
const view = createDeviceView({ $, state, deviceState, hideError() { document.getElementById('player-error').hidden = true; }, appendTrace() {}, updateTrace() {}, notifyParent() {},
  reportAPKError: (error, title) => controller.operations.reportAPKError(error, title), beginOperation: () => controller.operations.beginOperation(), finishOperation: token => controller.operations.finishOperation(token),
  clickView: id => controller.operations.clickView(id),
  hooks: { navigationChanged: value => controller.operations.navigationChanged(value), closed: snapshot => { status('Activity stack is empty.'); controller.operations.closed(snapshot); }, rendered: snapshot => { status(''); lastPendingDelay = snapshot.pendingEventDelay ?? null; lastQueue = snapshot.queueDebug; lastHealth = snapshot.vmHealth; lastRenderAt = performance.now(); controller.operations.snapshotRendered(snapshot); } } });
controller.attach(view); view.bindVM(vm);
let lastPendingDelay = null, lastRenderAt = 0, lastQueue = null, lastHealth = null;   // the VM's next scheduled event (see apk-worker currentSnapshot): a near event means the screen is about to change
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
if (!parentOrigin || parentOrigin === 'null') status('Missing or opaque ?parent= origin: this frame only runs inside <apk-player>.');
else post(envelope('hello'));

// Read-only introspection for automated checks (scripts/validation/browser-driver.mjs): true when no VM request, queued input or frame is in flight.
window.__apkPlayer = { idle: () => (lastPendingDelay === null || performance.now() - lastRenderAt >= Math.min(lastPendingDelay + 40, 120)) && !view.runtimeFrames.vmBusy && !state.busy && !controller.inflight && !state.inputPromise && !state.inputInFlight && !state.pendingInputs.size && !state.pendingFocus.length && !state.pendingComposeActions.length && !state.pendingScrolls.size && !state.pendingPointers.length && !state.composeInFlight && !view.runtimeFrames.requested && !view.runtimeFrames.pending, running: () => state.apkRunning, debug: () => ({ health: lastHealth, queue: lastQueue, vmBusy: view.runtimeFrames.vmBusy, sinceRender: Math.round(performance.now() - lastRenderAt), rendered: view.runtimeFrames.rendered, pendingDelay: lastPendingDelay, frames: { requested: view.runtimeFrames.requested, pending: !!view.runtimeFrames.pending }, pendingPointers: state.pendingPointers.length, pointerInFlight: state.pointerInFlight ?? null, pointerLog: state.pointerLog ?? [], busy: state.busy, lastError: state.lastAPKError ? String(state.lastAPKError.error?.message).slice(0, 300) : null }) };
