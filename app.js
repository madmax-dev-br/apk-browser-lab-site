import { APKWorkerClient } from './apk-worker-client.js?v=28012a33f717';
import { layoutBoundsRects, drawLayoutBounds } from './layout-bounds.js?v=28012a33f717';
import { FrameMeter, SAMPLE_MS } from './frame-meter.js?v=28012a33f717';
import { drawFrameGraph } from './frame-graph.js?v=28012a33f717';
import { clientIdentityStatus } from './client-identity.js?v=28012a33f717';
import { loadDeviceSettings, saveDeviceSettings, sanitizeSettings, defaultDeviceSettings, resolveDevice, deviceForVM, vmDeviceModel, DEFAULT_ENGINE, proxyState, relayChannelState, customIdentityForLoad, sanitizeCustomIdentity } from './device-settings.js?v=28012a33f717';
import { initCollapsibleSections } from './panel-sections.js?v=28012a33f717';
import { warmupLabel } from './warmup.js?v=28012a33f717';
import { createApkShelf, indexedDbShelfBackend, printableShelfId, resolveShelfApp } from './apk-shelf.js?v=28012a33f717';
import { ISO_COUNTRIES } from './iso-codes-data.js?v=28012a33f717';
import { initHelpTips } from './help-tips.js?v=28012a33f717';
import { initControlPanelUI } from './control-panel-ui.js?v=28012a33f717';
import { createToolDock } from './tool-dock.js?v=28012a33f717';
import { createPermissionsPanel } from './permissions-panel.js?v=28012a33f717';
import { createSharedFilesPanel } from './shared-files-panel.js?v=28012a33f717';
import { createAppDataPanel } from './app-data-panel.js?v=28012a33f717';
import { createCameraLab } from './camera-lab.js?v=28012a33f717';
import { createOverridesPanel } from './overrides-panel.js?v=28012a33f717';
import { createMethodHooksPanel } from './method-hooks-panel.js?v=28012a33f717';
import { createCodeTool } from './code-tool-loader.js?v=28012a33f717';   // the Code tool and the debugger: their modules load on first use (src/code-tool-loader.js)
import { createMicrogEntriesPanel } from './microg-entries-panel.js?v=28012a33f717';
import { createMicrogServicesPanel } from './microg-services-panel.js?v=28012a33f717';
import { microgDataText, canClearMicrogData } from './microg-data-panel.js?v=28012a33f717';
import { canAddGoogleAccount, googleAccountText } from './microg-account-panel.js?v=28012a33f717';
import { MICROG_SERVICES } from './microg-services.js?v=28012a33f717';
import { createMicrogSettingsDialog } from './microg-settings-dialog.js?v=28012a33f717';
import { createOrientationLock } from './orientation-lock.js?v=28012a33f717';
import { createIgnoredActivitiesPanel } from './ignored-activities-panel.js?v=28012a33f717';
import { createHostMapPanel } from './host-map-panel.js?v=28012a33f717';
import { createEndpointMocksPanel } from './endpoint-mocks-panel.js?v=28012a33f717';
import { createBlockedCallsPanel } from './blocked-calls-panel.js?v=28012a33f717';
import { MAX_PLUGINS } from './plugin-store.js?v=28012a33f717';
import { buildConfigDocument, parseConfigDocument, describeConfigDocument, planPluginImport, serializeConfig, configFileName, NOT_INCLUDED } from './config-bundle.js?v=28012a33f717';
import { EVENT_SECONDS_STEPS } from './time-limits.js?v=28012a33f717';
import { MEMORY_STEPS_MIB, memoryBudget } from './memory-budget.js?v=28012a33f717';
import { CORE_MEMORY_DEFAULT, checkCoreMemory, sameCoreMemory } from './core-memory.js?v=28012a33f717';
import { createDeviceView, createViewState } from './device-view.js?v=28012a33f717';
import { createTaskSwitcher } from './task-switcher.js?v=28012a33f717';
import { createDeviceZoom } from './device-zoom.js?v=28012a33f717';
import { buildDiagnosticReport, causeOf } from './diagnostic-report.js?v=28012a33f717';
import { formatApiGapReport } from './api-gap-scan.js?v=28012a33f717';
import { createLogcatPanel } from './logcat-panel.js?v=28012a33f717';
import { createComposeInspectorPanel, flattenViews, buildLayoutBoundsElements } from './compose-inspector-panel.js?v=28012a33f717';
import { createNetlogPanel, addAllowedHost } from './netlog-panel.js?v=28012a33f717';
import { createPluginHost, layoutBoundsElementOut } from './plugin-host.js?v=28012a33f717';
import { captureImage, paintScreen, drawnByDom, renderDomElement } from './screen-capture.js?v=28012a33f717';
import { createAppPalette } from './app-palette.js?v=28012a33f717';
import { createScreenRecorder } from './screen-recorder.js?v=28012a33f717';
import { createDeviceMedia } from './device-media.js?v=28012a33f717';
import { createPluginsPanel, powerStatsText } from './plugins-panel.js?v=28012a33f717';
import { createMcpTools, waitScreenReady } from './mcp-tools.js?v=28012a33f717';
import { createAdb } from './adb-commands.js?v=28012a33f717';
import { identityProperties, identityText, customIdentityFor } from './device-identity.js?v=28012a33f717';
import { createCustomIdentityPanel } from './custom-identity-panel.js?v=28012a33f717';
import { createAdbTerminal } from './adb-terminal.js?v=28012a33f717';
import { memorySummary } from './worker-memory.js?v=28012a33f717';
import { createMcpLink, migrateMcpSettings, mcpServeCommand, mcpAgentSetup, MCP_AGENTS, mcpBridgePort } from './mcp-link.js?v=28012a33f717';
import { createRelayDetector, localNetworkAccess, effectiveProxy, describeProxyForTrace } from './relay-detect.js?v=28012a33f717';
import { createPluginNetRoutes } from './plugin-net-routes.js?v=28012a33f717';
import { createModalHost } from './lab-modal.js?v=28012a33f717';
import { openPackageModal, defaultActivity } from './package-modal.js?v=28012a33f717';
import { createCustomScreenPanel } from './custom-screen-panel.js?v=28012a33f717';
import { createDeviceFullscreen } from './device-fullscreen.js?v=28012a33f717';
import { createSideTabHost, createTabAction } from './lab-side-tabs.js?v=28012a33f717';
import { createDragLayer } from './lab-drag.js?v=28012a33f717';
import { createLabScroll } from './lab-scroll.js?v=28012a33f717';
import { createGlSurfaces } from './gl-surfaces.js?v=28012a33f717';
import { createHighlightLayer, createHighlightAction } from './lab-highlight.js?v=28012a33f717';
import { createOverlayHost, createOverlayAction, frameGeometry } from './lab-overlays.js?v=28012a33f717';
import { buildDeepLinkRequest, describeDeepLink } from './deep-link-panel.js?v=28012a33f717';
import { resolveIntentFields } from './intent-resolver.js?v=28012a33f717';
const apkVM = new APKWorkerClient();
// The device's home screen keeps every APK opened here (src/apk-shelf.js: this browser's IndexedDB, with the file handle where the browser gives one), one icon beside the other.
const apkShelf = (() => { try { const backend = indexedDbShelfBackend(); return backend ? createApkShelf(backend) : null; } catch { return null; } })();
/** Records the launcher label and icon of this run on its home-screen entry. The VM can answer before the APK is saved (a new file has no entry yet): the save calls this again. */
function describeSavedApp() {
  const known = state.launcherInfo, info = known?.info;
  if (!apkShelf || !state.shelfId || !info || known.inventory !== state.inventory || !(info.label || info.icon)) return;
  apkShelf.describe(state.shelfId, { label: info.label ?? null, icon: info.icon ?? null }).then(refreshShelf).catch(() => {});
}
/** The Activities of a manifest that answer Intents (those with filters), as the home screen keeps them for each installed app: what a deep link is resolved against while the
 *  app is not the one in the VM. */
const intentActivities = inventory => (inventory?.activities ?? []).filter(activity => activity.filters?.length).map(activity => ({ name: activity.name, enabled: activity.enabled ?? null, filters: activity.filters }));
async function refreshShelf() { if (!apkShelf) return; try { taskSwitcher?.setShelf(await apkShelf.list(), state.shelfId ?? null); } catch (error) { appendTrace(`Home screen: ${error?.message ?? error}`); } }
async function openSavedApp(id) {
  if (!apkShelf) return;   // another app while one loads or runs: importSource ends the current VM first
  state.reimportShelfId = null;
  try {
    const got = await apkShelf.file(id); if (!got) { await refreshShelf(); return; }
    appendTrace(got.fromDisk ? `Opening ${got.file.name} from disk (file saved on the home screen)` : `Opening the saved copy of ${got.file.name}${got.note ? ` (${got.note})` : ''}`);
    await importSource({ file: got.file, name: got.file.name, shelfId: id }, true);   // a tap on a launcher icon starts the app
  } catch (error) {
    // The stored APK cannot be used (src/apk-shelf.js ShelfFileError): the icon stays, marked, and the error offers to choose the file again, which replaces that copy.
    if (error?.reimport && error.shelfId) { state.reimportShelfId = error.shelfId; await refreshShelf(); }
    reportAPKError(error, 'Could not open the saved app', { crash: false });
  }
}
// The browser's file picker with a handle (showOpenFilePicker), for every format the lab opens. Returns { handle } once a file is chosen, 'cancelled' when the user closed
// it, or null when this browser refused to show it (the caller then opens the plain input, once). After a file is chosen, nothing opens a second picker: a problem reading or
// opening that file is reported (it used to fall through to the plain input, so the picker came back right after the user chose a file).
const APK_PICKER_TYPES = [{ description: 'Android app (.apk, .aab, .apks, .xapk, .apkm)', accept: { 'application/vnd.android.package-archive': ['.apk', '.apks', '.xapk', '.apkm'], 'application/octet-stream': ['.aab', '.apks', '.xapk', '.apkm'] } }];
// Some embedded browsers show the handle picker but then refuse handle.getFile() (NotAllowedError). Once that happens, this browser uses the plain input from then on (remembered).
const HANDLE_PICKER_KEY = 'apkweb.handlePicker.unusable';
// An embedded Chromium (its brand list names no browser vendor, as an app's web view) shows the handle picker and refuses the file afterwards, so the person would choose the file
// twice: there the plain input is used from the first time. Navigators without a brand list are not Chromium and have no handle picker.
const isVendorBrowser = () => (navigator.userAgentData?.brands ?? []).some(({ brand }) => /Google Chrome|Microsoft Edge|Opera|Brave|Vivaldi|Yandex/i.test(brand));
const handlePickerUsable = () => { if (!isVendorBrowser()) return false; try { return typeof window.showOpenFilePicker === 'function' && localStorage.getItem(HANDLE_PICKER_KEY) !== '1'; } catch { return typeof window.showOpenFilePicker === 'function'; } };
async function pickApkWithHandle() {
  if (!handlePickerUsable()) return null;
  try { const [handle] = await window.showOpenFilePicker({ types: APK_PICKER_TYPES, excludeAcceptAllOption: false }); return handle ? { handle } : 'cancelled'; }
  catch (error) { return error?.name === 'AbortError' ? 'cancelled' : null; }
}
/** Opens the chosen file. Returns false when this browser refused to read a picked handle: the caller then opens the plain input (this once; later picks go straight to it). */
async function openPickedApk({ handle }) {
  let file;
  try { file = await handle.getFile(); }
  catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      try { localStorage.setItem(HANDLE_PICKER_KEY, '1'); } catch { /* the plain input is used this time anyway */ }
      setStatus('This browser does not let the page read the file chosen in its file picker; choose it once more in the standard picker (if it does not open by itself, click "choose a file" again; from now on only that picker opens)');
      return false;
    }
    reportAPKError(error, 'Could not read the chosen file', { crash: false }); return true;
  }
  try { await chooseFile(file, handle); } catch (error) { reportAPKError(error, 'Could not open the chosen file', { crash: false }); }
  return true;
}
/** "Choose the APK again": the file picker, for an installed app whose stored copy could not be opened. The file chosen takes that entry's place (its icon and label stay). */
async function reimportSavedApp() {
  const id = state.reimportShelfId; if (!id) return;
  dismissError(); state.pendingReplaceShelfId = id;
  const picked = await pickApkWithHandle();
  if (picked === 'cancelled') { state.pendingReplaceShelfId = null; return; }
  if (picked && await openPickedApk(picked)) return;
  $('apk-file').click();   // no usable handle picker here: the plain input; its change event takes pendingReplaceShelfId
}
async function removeSavedApp(item) {
  if (!apkShelf) return;
  const name = item.label || item.name;
  if (state.busy) { setStatus(`${name} can't be uninstalled while an APK is loading or an operation runs; wait for it to finish (or stop it) and try again`); return; }
  const yes = await modalHost.ask({ title: `Uninstall ${name}?`, message: 'The copy stored in this browser is deleted. The APK file on your disk is not changed.', confirmLabel: 'Uninstall', danger: true });
  if (!yes) return;
  if (state.shelfId === item.id && state.inventory) {   // the app on screen: it closes, as an uninstall closes it on a device
    cancelOperation(); markLastRunEnded(); state.currentSource = null; state.inventory = null; state.needsRestart = false;
    $('preview-name').textContent = 'App preview'; appInfo.render();
  }
  await apkShelf.remove(item.id); if (state.shelfId === item.id) state.shelfId = null; await refreshShelf(); setStatus(`${name} uninstalled`); appendTrace(`${name} uninstalled from the home screen (its stored copy deleted)`);
}
// The VM Worker starts with the page and fetches and compiles the lab's assets (framework, Skia, ICU, the core) while the user picks an APK; the first load uses it (src/apk-worker-client.js prewarm).
setTimeout(() => apkVM.prewarm?.(), 0);
const $ = (id) => document.getElementById(id);
const state = { mode: 'apk', runtime: null, inventory: null, apkRunning: false, canGoBack: false, busy: false, trace: [], composeStarted: false, composeReady: false, composeTimer: null, catalogLoading: false, currentSource: null, launchAttempted: false, operation: 0, operationTimer: null, abortController: null, lastAPKError: null, ...createViewState() };
let taskSwitcher = null;   // SystemUI navigation of the device (src/task-switcher.js), created once the device view exists
const params = new URLSearchParams(location.search);
if (params.get('embed') === '1') document.body.classList.add('is-embedded');

function notifyParent(type, data = {}) {
  if (window.parent !== window) window.parent.postMessage({ type, ...data }, location.origin);
}
/** The empty stage's hint. The published site carries no example APKs (no catalog): there the hint does not point at an Examples tab that is not there. */
function emptyPreviewHint() { return !state.bundledApks ? 'Select an APK: it is installed and opened right away.' : 'Select an APK: it is installed and opened right away.<br>Or pick one of the examples in the Examples tab, on the bottom bar.'; }
function setStatus(message, kind = '') {
  $('status-text').textContent = message;
  $('status-dot').className = kind;
  notifyParent('apk-lab-state', { mode: state.mode, status: message, running: kind === 'ok' });
}
// "Tela pronta" (src/screen-ready.js): the Activity and its fragments loaded and the screen is still; the title says what it still waits for.
function showScreenReady(ready) {
  const chip = $('screen-ready'); if (!chip) return;
  if (!ready || !state.apkRunning) { chip.hidden = true; return; }
  chip.hidden = false; chip.dataset.ready = String(!!ready.ready); chip.textContent = ready.ready ? '● ready' : '◌ loading';
  chip.title = ready.ready ? `Screen ready: ${ready.activity ?? ''}${ready.fragments?.length ? ` with ${ready.fragments.length} fragment(s)` : ''}` : `Still loading: ${(ready.waitingFor ?? []).join('; ')}`;
}
// "Aquecendo" (src/warmup.js): the VM is still paying for first-time work (classes, methods prepared on their first call); the title has the numbers.
function showWarmup(warmup) {
  const chip = $('vm-warmup'); if (!chip) return;
  const label = state.apkRunning ? warmupLabel(warmup) : null; if (!label) { chip.hidden = true; return; }
  chip.hidden = false; chip.dataset.ready = String(!label.warming); chip.textContent = label.text; chip.title = label.title;
}
function setBusy(busy) {
  state.busy = busy;
  if ($('clear-app-data')) $('clear-app-data').disabled = busy || !state.runtime;
  if ($('clear-microg-data')) $('clear-microg-data').disabled = !canClearMicrogData({ busy, running: !!state.runtime, loadedMicrog: state.loadedMicrog });
  showMicrogAccount();
  document.querySelectorAll('[data-inspect-apk]').forEach((button) => { button.disabled = button.dataset.available === 'false'; });   // another APK can be picked at any time (it replaces the current VM)
}
function appendTrace(message) {
  state.trace.push(message);
  if (state.trace.length > 1000) state.trace = state.trace.slice(-1000);
  $('trace-output').textContent = state.trace.join('\n');
  $('trace-count').textContent = `${state.trace.length} events`;
}
function updateTrace(snapshot) {
  if (!Array.isArray(snapshot.trace)) return;
  state.trace = snapshot.trace.map((item) => typeof item === 'string' ? item : JSON.stringify(item));
  $('trace-output').textContent = state.trace.join('\n') || 'No events recorded.';
  $('trace-count').textContent = `${state.trace.length} events`;
}
function resetWebViews() { try { deviceView.resetWebViews?.(); } catch { /* the device view is not created yet: no WebView exists either */ } }
function hideError() { $('error-panel').hidden = true; }
/** A launch or click that passed the soft wall budget keeps running while it makes progress: say so instead of looking frozen. */
apkVM.onHeartbeat = beat => { if (beat?.soft && state.mode === 'apk') setStatus(`Still running (${Math.round((beat.wallMs ?? 0) / 1000)} s) · the VM keeps advancing: ${(beat.stack ?? []).slice(0, 1).join('') || 'no Java stack'}`); };
/** "Screen state" from the live Worker (null when it is gone or has nothing loaded). */
/** The page-side account of a VM that cannot answer: why (no Worker, an operation still running, a failed request), the last signal it sent, its memory at the last snapshot and the tail of the log. */
function screenStateUnavailable(reason) {
  const pending = apkVM.pending, lines = ['Screen state', `The VM did not answer the state request: ${reason}.`];
  if (!apkVM.worker) lines.push('There is no Web Worker: no APK has been loaded in this page, or the Worker was ended (error, time limit or "Terminate"); reopen the APK.');
  else if (pending) lines.push(`The VM is still busy with the "${pending.type}" operation for ${Math.round((Date.now() - pending.startedAt) / 1000)} s; a busy Worker only answers between two events. The data below is the last signal it sent.`);
  if (apkVM.worker) { try { lines.push(apkVM.describeLastSignal(pending?.type ?? 'state').text); } catch { /* no signal yet */ } }
  const beat = apkVM.lastHeartbeat?.vm; if (beat) lines.push(`In the last signal: ${beat.objects} of ${beat.limit} live objects, ${beat.collections} garbage collections (${beat.gcMs} ms), top Activity: ${beat.activity ?? 'none'}. Collector: ${beat.gcEnabled ? 'on' : 'OFF'}, collection floor ${beat.gcFloor ?? '?'} objects, ${beat.gcBlocked ? `blocked right now by "${beat.gcBlocked}"` : 'free to collect right now'}, nested runs ${beat.nestedRuns ?? 0}, skipped collections ${JSON.stringify(beat.gcSkips ?? {})}.`);
  const health = state.lastVmHealth; if (health) lines.push(`Memory at the last frame: ${health.liveObjects} of ${health.limit} live objects (${Math.round(100 * health.liveObjects / health.limit)}%), ${health.collections ?? 0} collections, last event ${health.lastEventMs ?? 0} ms${health.oomCount ? `, ${health.oomCount} OutOfMemoryError` : ''}.`);
  lines.push(`Page status: ${$('status-text')?.textContent ?? ''}`, `Operation on screen: ${$('operation-panel')?.hidden ? 'none' : $('operation-message')?.textContent}`);
  const log = ($('trace-output')?.textContent ?? '').split('\n').filter(Boolean).slice(-25); if (log.length) lines.push('End of the execution log:', ...log.map(line => '  ' + line));
  return { text: lines.join('\n'), blank: false };
}
async function fetchScreenState() {
  if (!apkVM.worker) return screenStateUnavailable('no Worker');
  try { return await apkVM.screenState(); } catch (error) { return screenStateUnavailable(error?.message ?? String(error)); }
}
document.getElementById('screen-state-copy')?.addEventListener('click', async event => {
  const button = event.currentTarget, screen = await fetchScreenState(), report = screen.text;
  try { await navigator.clipboard.writeText(report); button.textContent = screen?.blank ? 'Copied (blank screen)' : 'Screen state copied'; }
  catch { $('trace-output').textContent = report; $('trace').open = true; getSelection()?.selectAllChildren($('trace-output')); button.textContent = 'Selected: copy with Cmd+C'; }
  setTimeout(() => { button.textContent = 'Copy screen state'; }, 2500);
});
/** The "== Summary ==" block of a report (at most 40 lines): what one photo of the screen must contain. */
function extractSummary(text) {
  const lines = String(text ?? '').split('\n'), start = lines.findIndex(line => /^== (Summary|Resumo) ==$/.test(line)); if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^== (end of summary|fim do resumo) ==$/.test(line));
  // wrapped at ~70 characters with a hanging indent, never cut with an ellipsis: the overlay scrolls if the block is longer than the screen
  const wrap = line => { if (line.length <= 70) return [line]; const out = []; let rest = line, first = true; while (rest.length > 0) { const width = first ? 70 : 66; if (rest.length <= width) { out.push((first ? '' : '    ') + rest); break; } let cut = rest.lastIndexOf(' ', width); if (cut < 20) cut = width; out.push((first ? '' : '    ') + rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); first = false; } return out; };
  return lines.slice(start, end > start ? end : start + 60).flatMap(wrap).join('\n');
}
function showSummary(text) {
  const summary = extractSummary(text) ?? 'Summary unavailable: there is no VM data yet (no APK running, or the Worker was ended before generating the report).';
  $('summary-text').textContent = summary; $('summary-overlay').hidden = false;
}
document.getElementById('summary-close')?.addEventListener('click', () => { $('summary-overlay').hidden = true; });
document.getElementById('screen-state-summary')?.addEventListener('click', async () => { const screen = await fetchScreenState(); showSummary(screen?.text); });
document.getElementById('error-summary')?.addEventListener('click', async () => { const report = state.errorReport ?? $('error-message').textContent; showSummary(extractSummary(report) ? report : (await fetchScreenState())?.text ?? report); });
document.getElementById('error-copy')?.addEventListener('click', async event => {
  const screen = await fetchScreenState(); if (!state.apiGaps) await apkVM.requestApiGaps?.(4000).catch(() => null);   // the Worker scans on request (asked when the error was shown): the copy waits a little for it
  const button = event.currentTarget, report = (state.errorReport ?? $('error-message').textContent) + (screen ? '\n\n' + screen.text : '') + '\n\n' + (state.apiGaps ? formatApiGapReport(state.apiGaps) : '(The static API estimate was not computed: no APK is loaded or its scan did not finish in time. Click Copy diagnostics again, or run scripts/report-apk-api-gaps.mjs on the APK.)') + (pluginHost.runningCount ? '\n\n' + powerStatsText(await apkVM.pluginPowerStatus().catch(() => pluginHost.workerStats) ?? { level: pluginHost.power }) : '');   // the static API estimate may arrive after the error was shown
  try { await navigator.clipboard.writeText(report); button.textContent = 'Diagnostics copied'; }
  catch { $('error-detail').textContent = report; $('error-detail').hidden = false; $('error-diagnostics').hidden = false; $('error-diagnostics').open = true; getSelection()?.selectAllChildren($('error-detail')); button.textContent = 'Selected: copy with Cmd+C'; }
  setTimeout(() => { button.textContent = 'Copy diagnostics'; }, 2500);
});
function showError(error, title = 'Run attempt interrupted') {
  apkVM.requestApiGaps?.()?.catch?.(() => {});   // the static API estimate is a section of the diagnostics: the Worker scans while the person reads the error
  const inventory = state.mode === 'apk' ? state.inventory : null;
  const raw = error?.message || String(error);
  $('error-title').textContent = /JNI|native method|native library/i.test(raw) ? 'Native execution limit' : title;
  if ($('error-reimport')) $('error-reimport').hidden = !state.reimportShelfId;   // an installed app that could not be opened: choose its APK again
  const cause = causeOf(raw);
  $('error-message').textContent = cause.length > 800 ? '…' + cause.slice(-800) : cause;
  const details = [...(inventory?.unsupportedFeatures || [])];
  if (cause !== raw || cause.length > 800) details.push('Call stack:\n' + raw);
  if (error.details) details.push(typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2));
  if (error.trace?.length) details.push('Last VM instructions:\n' + error.trace.slice(-40).join('\n'));
  $('error-detail').textContent = [...new Set(details)].join('\n');
  state.errorReport = buildDiagnosticReport({ error, packageName: inventory?.packageName ?? state.fileName ?? 'APK', tolerateMissing: $('tolerate-missing')?.value ?? 'off', methodOverrides: overridesPanel.activeCount(), appModified: methodHooksPanel?.pluginCount() ?? 0, ignoredActivities: ignoredPanel.activeCount(), endpointMocks: mocksPanel.activeCount(), hostRedirects: hostMapPanel.activeLines(), build: document.querySelector?.('script[src*="app.js"]')?.src?.split('v=')[1] ?? '' }).text;
  $('error-detail').hidden = !details.length;
  $('error-diagnostics').hidden = !details.length;
  $('error-diagnostics').open = false;
  $('error-panel').hidden = false;
  $('runtime-badge').className = 'runtime-badge';
  $('runtime-badge').innerHTML = '<span></span> INTERRUPTED';
  setStatus('Run attempt interrupted · real VM diagnostics', 'error');
  appendTrace(`ERROR: ${raw}`);
}
/** A failure shown in the error window. `crash` (default: an app was started in this VM) means the app died: its window closes, the device shows the launcher with the app's
 *  icon, and the VM is detached from the page (no frame or later error of it reaches the screen; it stays alive only for the diagnostics of the error window). A tap on the icon
 *  reopens the APK in a fresh Worker (needsRestart). `crash: false` is a failure that leaves the app as it was (an ELF inspection, a saved app that could not be read). */
function reportAPKError(error, title, { crash = state.launchAttempted } = {}) {
  if (error?.code === 'debugger-paused') { setStatus('Paused in the debugger: the app\'s threads are suspended, so it takes no input now · resume (F8) to use the app'); appendTrace(`Refused while paused in the debugger: ${title ?? error.message}`); return; }   // not a failure of the app
  // System.exit(0) (or Runtime.exit(0)/halt(0), the same host stop): the app ended its own process on purpose. On a device this shows nothing — no crash dialog, the window
  // and process are just gone — so the lab ends the app the same way it does for a force-stop or a recents swipe, never as an interrupted run needing diagnostics.
  if (error?.details?.kind === 'process-exit' && error.details.status === 0 && state.mode === 'apk' && state.currentSource) { endAppProcess('The app ended its own process (System.exit(0)); tap its icon on the home screen to open it again in a new VM.'); return; }
  state.lastAPKError = { error, title }; state.needsRestart = !!state.currentSource;   // after a failure the VM may be stuck or half-dead: the next start reopens the APK in a fresh Worker
  state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  $('android-content').inert = true; $('android-window-layer').inert = true;
  if (error.navigation) state.canGoBack = !!error.navigation.canGoBack;
  if (!apkVM.worker) { state.runtime = null; state.apkRunning = false; }
  if (crash && state.mode === 'apk' && state.currentSource) closeCrashedApp();
  if (state.mode === 'apk') showError(error, title);
  else appendTrace(`APK ERROR: ${error.message || error}`);
  if (crash && state.mode === 'apk' && state.currentSource) setStatus('The app stopped because of an error · tap its icon on the home screen to open it again', 'error');
}
/** The app died (an uncaught exception, an unsupported API, the VM or its Worker lost): as Android does, its window goes and the launcher is on screen with the app's icon. */
function closeCrashedApp(note = 'The app was ended by the error; tap its icon on the home screen to open it again in a new VM.') {
  state.runtime = null; state.apkRunning = false; state.canGoBack = false; state.stickyError = false; state.viewSession++;   // the VM is detached: its frames and errors no longer reach the page
  $('android-action-mode-layer')?.replaceChildren(); showScreenReady(null); showWarmup(null); orientationLock.reset();
  taskSwitcher?.closed(); $('preview-name').textContent = state.inventory?.packageName || state.currentSource?.name || 'App preview';
  appendTrace(note);
}
/** The process behind the running app is gone with nothing more to show (System.exit, a force-stop, the recents card swiped away): the device goes to its launcher, the app's
 *  icon ready to open it again in a fresh VM (a new Worker: the old one is terminated, as a real process is once it exits). No error window — a device shows none either. */
function endAppProcess(note) {
  state.needsRestart = true; state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  apkVM.cancel(); hideError(); markLastRunEnded();   // ended on its own: the next visit must not report it as a run that stopped without warning
  closeCrashedApp(note);
  setStatus('App ended · tap its icon on the home screen to open it again'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> ENDED';
}
/** The user threw the app away (its recents card dragged off, or the window flung up: src/task-switcher.js), or adb closed it (am force-stop): as when Android removes a
 *  task from the recents, the app's process is killed with no further callback. */
function dismissApp(by = 'by the user (swiped out of the recents)') {
  if (state.mode === 'apk' && state.currentSource && state.opening) {   // thrown away while it opened: the open ends with its VM, and the icon opens it again from the start
    cancelOperation(); state.needsRestart = true; taskSwitcher?.closed();
    appendTrace(`The app was ended ${by} while it opened; tap its icon on the home screen to open it again in a new VM.`);
    setStatus('App ended · tap its icon on the home screen to open it again'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> ENDED'; return;
  }
  if (state.mode !== 'apk' || !state.currentSource || !state.runtime) return;
  endAppProcess(`The app was ended ${by}: its process was killed; tap its icon on the home screen to open it again in a new VM.`);
}
/** "Close" (or Esc) on the error window: the device is on screen again, its launcher with the app's icon focused (Enter reopens it). */
function dismissError() {
  if ($('error-panel').hidden) return;
  hideError(); state.lastAPKError = null; state.stickyError = false;
  if (state.mode === 'apk' && !state.apkRunning) taskSwitcher?.focusApp?.();   // the launcher was on screen under the window already
}
// The opening of an app (the page's opening session): from the moment its APK is chosen (or its icon tapped) until the app's first frame, one screen and one clock. The device
// shows the app's starting window (#boot-overlay, inside the device like Android's splash screen: the app's icon on a plain background, under the system bars, moved by the
// task gestures with the app's other windows) and the status line says one of two things, the APK being read or the Activity being opened, with the seconds since the start.
// The time it took in all is the one the status bar keeps ("opened in"); the details say how it split.
const OPENING_MESSAGE = { read: 'Reading the APK…', open: 'Opening the activity…' };
function beginOpening() { state.opening = { startedAt: performance.now(), stage: 'read' }; appInfo.render(); return state.opening; }
function openingStage(stage) { if (!state.opening) return; state.opening.stage = stage; const message = OPENING_MESSAGE[stage]; $('operation-message').textContent = message; $('operation-progress').removeAttribute('value'); setBootCaption(message); if (state.mode === 'apk') setStatus(message); }
/** The opening session `session` ended (the app's first frame, a failure, another APK): the status line and the starting window go as an operation's do. */
function endOpening(session) {
  if (!session || state.opening !== session) return; state.opening = null;
  if (!state.busy) { clearInterval(state.operationTimer); $('operation-panel').hidden = true; }
  hideBoot(); appInfo.render(); taskSwitcher?.opened?.();
  const palette = state.paletteAfterOpen; state.paletteAfterOpen = null; if (palette && palette === taskSwitcher?.icon?.()) appPalette.fromURL(palette);
}
/** The starting window goes at once, without its fade (the run it belonged to was ended). */
function dropBoot() { const overlay = $('boot-overlay'); clearTimeout(state.bootTimer); state.bootVisible = false; if (overlay) { overlay.hidden = true; overlay.classList.remove('fading', 'idle'); } }
// The caption sits in a box of fixed height under the logo (styles.css .boot-caption): a longer or shorter status never moves the logo; the full text is the tooltip.
/** No app window on screen: the device shows its launcher. 'idle' (nothing opened yet), 'installing' (the package is being read) or 'installed' (tap the icon to start). */
function showDeviceHome(mode = state.homeMode ?? 'idle', label = '') {
  if (!taskSwitcher || !deviceView) return;
  state.homeMode = mode; showDeviceFrame();
  taskSwitcher.home(mode, { label, key: mode === 'installed' ? state.inventory : null });
}
/** The device on the stage with its system bars (the app's own bars once it draws). */
function showDeviceFrame() {
  const d = resolveDevice(deviceState.settings), buttons = d.navigation === 'buttons';
  if (!state.apkRunning) deviceView.renderSystemBars({ widthDp: d.widthDp, heightDp: d.heightDp, status: { height: 24, visible: true, color: 0, light: false }, nav: { mode: buttons ? 'buttons' : 'gesture', thickness: buttons ? 48 : 24, side: 'bottom', visible: true, color: 0, light: false }, contentFrame: { left: 0, top: 0, right: d.widthDp, bottom: d.heightDp } });
  $('android-device').hidden = false; $('android-device').inert = false; $('empty-preview').hidden = true;
}
/** The app's own icon on its starting window, like Android's splash screen (the Android mark while the package has none to show yet); one known only once the APK was read fades in. */
function showBootIcon(url, { fade = true } = {}) {
  const overlay = $('boot-overlay'), icon = $('boot-app-icon'); if (!overlay || !icon) return;
  if (!url) { icon.hidden = true; icon.removeAttribute?.('src'); overlay.classList.remove('has-app-icon'); return; }
  if (icon.getAttribute?.('src') === url && !icon.hidden) return;
  icon.src = url; icon.hidden = false; overlay.classList.add('has-app-icon');
  if (fade) icon.animate?.([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
}
function setBootCaption(text) { const caption = $('boot-caption'); if (!caption) return; caption.textContent = text; caption.title = text; }
function showBoot(caption) {
  const overlay = $('boot-overlay'); if (!overlay) return;
  clearTimeout(state.bootTimer); setBootCaption(caption); overlay.classList.remove('fading', 'idle'); overlay.hidden = false;
  $('android-device').hidden = false; $('android-device').inert = false;
  showBootIcon(taskSwitcher?.icon?.() ?? null, { fade: false });   // the app's own icon, like Android's splash screen; the Android mark only when the package has none to show
  $('empty-preview').hidden = true; state.bootVisible = true;
}
function hideBoot({ force = false } = {}) {
  const overlay = $('boot-overlay'); if (!overlay || !state.bootVisible) return;
  if (!force && state.opening) return;   // between reading the APK and opening its Activity the starting window stays: one screen for the whole open
  // An APK that is loaded but not running keeps the phone frame on screen, idle, with the one thing the user can do next; the frame only goes away when the app
  // draws its first frame (force) or when there is no APK (an error, a closed file).
  const left = ['home', 'overview'].includes(taskSwitcher?.state?.());   // the user left the app while it opened: the launcher or the recents stay as they are
  if (!force && left) { dropBoot(); return; }
  if (!force && state.currentSource && !state.apkRunning && !state.lastAPKError && state.mode === 'apk') { state.bootVisible = false; overlay.hidden = true; overlay.classList.remove('fading', 'idle'); showDeviceHome(state.runtime ? 'installed' : state.homeMode); return; }   // loaded but not running: the launcher with the app's icon
  state.bootVisible = false; overlay.classList.add('fading'); overlay.classList.remove('idle'); clearTimeout(state.bootTimer);
  state.bootTimer = setTimeout(() => { overlay.hidden = true; overlay.classList.remove('fading'); if (!state.apkRunning && state.mode === 'apk' && !['home', 'overview'].includes(taskSwitcher?.state?.())) showDeviceHome(); }, 380);
}
function beginOperation(message) {
  const token = ++state.operation;
  setBusy(true); $('operation-panel').hidden = false;
  $('operation-message').textContent = message; $('operation-progress').removeAttribute('value');
  // Each operation counts its own time from zero: the line is written at once, so it never shows the seconds of the operation before it (loading, then starting the Activity).
  const started = state.opening?.startedAt ?? performance.now(), tick = () => { $('operation-detail').textContent = `${Math.floor((performance.now() - started) / 1000)} s`; };   // an opening counts from its start, across the read and the launch   // the status line has room for the time; what it means is the element's title
  clearInterval(state.operationTimer); tick();
  state.operationTimer = setInterval(tick, 1000);
  return token;
}
function finishOperation(token) {
  if (token !== state.operation) return;
  clearInterval(state.operationTimer); hideBoot(); if (!state.opening) $('operation-panel').hidden = true; state.abortController = null; setBusy(false); if (state.pendingInputs.size || state.pendingFocus.length || state.pendingComposeActions.length || state.pendingScrolls.size || state.pendingPointers.length || state.pendingScrollBys.size) flushPendingInputs();
}
/** Load timing per stage (shown under the inspection and in the execution log): the phases the Worker reports, from the first to the last. */
function notePhase(phase) {
  const times = state.loadTimes; if (!times || times.done || !phase) return;
  const now = performance.now(), last = times.phases.at(-1);
  if (last && last.phase === phase) return;
  if (last) last.ms = Math.round(now - last.at);
  times.phases.push({ phase, at: now, ms: 0 });
}
const PHASE_LABEL = { image: 'load image', manifest: 'manifest', dex: 'code (DEX)', framework: 'framework', 'framework-resources': 'Android styles', resources: 'resources', 'resources-xml': 'layouts and XML', native: 'native libraries', core: 'VM core' };
/** The phases of a load as the line shows them: the Worker's own measurement when it sent one (loadTiming: the loader prepares resources while the DEX files expand and releases its
 *  progress reports together, so the intervals between the reports the page receives are not the phases' times), else those intervals. Phases without a label add up as "other". */
function loadPhaseParts(times) {
  const rows = times.workerPhases ?? times.phases.map(item => [item.phase, item.ms]), byLabel = new Map(); let other = 0;
  for (const [phase, ms] of rows) { if (!(ms > 0)) continue; const label = PHASE_LABEL[phase]; if (label) byLabel.set(label, (byLabel.get(label) ?? 0) + ms); else if (times.workerPhases) other += ms; }
  const parts = [...byLabel].map(([label, ms]) => `${label} ${ms} ms`); if (other > 0) parts.push(`other ${other} ms`);
  return parts;
}
/** "Loaded in 0.21 s (...)" and, once an Activity opened, "Activity opened in 1.14 s": two times, each of its own operation (a launch can come long after the load, or again). */
function showLoadTimes() {
  const times = state.loadTimes; if (!times) return;
  const seconds = ms => (ms / 1000).toFixed(2);
  let text = `Loaded in ${seconds(times.loadMs)} s (${[`file read ${times.readMs} ms`, ...loadPhaseParts(times)].join(' · ')})`;
  if (times.launchMs !== undefined) text += ` · Activity opened in ${seconds(times.launchMs)} s`;
  state.loadTimes.text = text; appInfo.render();
}
// ---- the open package: its line in the status bar (with the details on hover or focus), the Activity its icon opens ----
/** The Activity the launcher icon opens, per package: chosen in the Package window (src/package-modal.js), kept in localStorage across reloads (a per-viewer convenience: blocked
 *  storage keeps it for this page's life only); undefined: the manifest's own. An activity the APK no longer declares is ignored (launchActivity checks it). */
const LAUNCH_CHOICES_KEY = 'apkweb.launchChoices.v1';
const launchChoices = (() => {
  const map = new Map();
  try { const stored = JSON.parse(globalThis.localStorage?.getItem(LAUNCH_CHOICES_KEY) ?? '{}'); for (const [pkg, name] of Object.entries(stored ?? {})) if (typeof pkg === 'string' && typeof name === 'string') map.set(pkg, name); } catch { /* storage blocked or bad record: none */ }
  const save = () => { try { globalThis.localStorage?.setItem(LAUNCH_CHOICES_KEY, JSON.stringify(Object.fromEntries(map))); } catch { /* storage blocked: kept in memory */ } };
  return { get: key => map.get(key), has: key => map.has(key), set(key, value) { map.set(key, value); save(); return this; }, delete(key) { const had = map.delete(key); save(); return had; } };
})();
function launchActivity(inventory = state.inventory) {
  const chosen = inventory?.packageName ? launchChoices.get(inventory.packageName) : undefined;
  return chosen && (inventory.activities ?? []).some(activity => (typeof activity === 'string' ? activity : activity?.name) === chosen) ? chosen : undefined;
}
/** What the icon opens: the Package window's choice, else the manifest's launcher, else (no unique launcher, e.g. a build whose MAIN/LAUNCHER Activity is in another
 *  flavour) the first Activity the manifest declares, as the old launcher select did by showing that option first. undefined only for an APK with no Activity. */
function activityToLaunch(inventory = state.inventory) {
  const first = (inventory?.activities ?? []).map(activity => (typeof activity === 'string' ? activity : activity?.name)).find(Boolean);
  return launchActivity(inventory) ?? defaultActivity(inventory) ?? first ?? undefined;
}
/** The app's name as the launcher shows it (its label once the VM answered), else the package id, else the file name. */
function appLabel() {
  const known = state.launcherInfo, label = known?.inventory === state.inventory ? known?.info?.label : null;
  return label || state.inventory?.packageName || String(state.currentSource?.name ?? 'App').replace(/\.(apk|aab|apks|xapk|apkm)$/i, '');
}
/** "Launch" in the Package window: the choice is recorded for the package and the app opens again from zero with it, as the old select and "Reopen" did (reopenApp). */
function launchWith(name) {
  const inventory = state.inventory; if (!inventory?.packageName || !name) return;
  if (name === defaultActivity(inventory)) launchChoices.delete(inventory.packageName); else launchChoices.set(inventory.packageName, name);
  appendTrace(`Launch activity: ${name}${launchChoices.has(inventory.packageName) ? ' (chosen in the Package window)' : ' (the manifest\'s)'}`); appInfo.render();
  if (state.launchAttempted || state.needsRestart) reopenApp(); else runAPK();
}
function showPackageWindow() {
  const inventory = state.inventory; if (!inventory) return null;
  return openPackageModal({ modalHost, inventory, label: appLabel(), icon: taskSwitcher?.icon?.() ?? null, file: { name: state.currentSource?.name ?? null, bytes: state.currentFileBytes ?? null },
    current: activityToLaunch() ?? null, busy: () => state.busy || !!state.runStarting || !state.currentSource, onLaunch: launchWith });
}
/** The status bar's line about the open app ("Counter · loaded in 0.43 s") and its details on hover, focus or a tap (load times by phase, package, version, Activity, engine, ABI). */
const appInfo = (() => {
  const button = $('app-info'), panel = $('app-info-detail'), seconds = ms => `${(ms / 1000).toFixed(2)} s`;
  if (!button || !panel) return { render() {}, hide() {} };
  const row = (label, value, { sub = false, note = null } = {}) => { const line = document.createElement('div'); line.className = sub ? 'md-row md-sub' : 'md-row'; const a = document.createElement('span'), b = document.createElement('strong'); a.textContent = label; b.textContent = value; line.append(a, b); if (note) { const small = document.createElement('small'); small.textContent = note; line.append(small); } return line; };
  function fill() {
    const inventory = state.inventory, times = state.loadTimes, rows = [];
    rows.push(row(appLabel(), inventory?.manifestAttrs?.versionName ? `version ${inventory.manifestAttrs.versionName}` : ''));
    if (times?.done) {
      if (times.totalMs !== undefined) rows.push(row('Opened in', seconds(times.totalMs)));   // the whole open; how it split below
      rows.push(row(times.totalMs !== undefined ? 'APK read in' : 'Loaded in', seconds(times.loadMs)), row('file read', `${times.readMs} ms`, { sub: true }));
      for (const part of loadPhaseParts(times)) { const at = part.lastIndexOf(' ', part.length - 4); rows.push(row(part.slice(0, at), part.slice(at + 1), { sub: true })); }
      if (times.launchMs !== undefined) rows.push(row('Activity started in', seconds(times.launchMs)));
    }
    if (inventory?.packageName) rows.push(row('Package', inventory.packageName));
    if (inventory?.manifestAttrs?.versionCode !== undefined) rows.push(row('Version code', String(inventory.manifestAttrs.versionCode)));
    if (inventory?.usesSdk) rows.push(row('SDK', `min ${inventory.usesSdk.minSdkVersion ?? '—'} · target ${inventory.usesSdk.targetSdkVersion ?? inventory.usesSdk.minSdkVersion ?? '—'}`));
    const activity = activityToLaunch(inventory);
    if (activity) rows.push(row('Launch activity', activity.split('.').pop(), { note: launchActivity() ? `${activity} · chosen in the Package window` : activity }));
    if (state.loadedEngine) rows.push(row('Engine', state.loadedEngine === 'js' ? 'JavaScript VM' : 'WebAssembly core'));
    rows.push(row('Device ABI', state.runArm64 ? 'arm64-v8a, wasm32' : 'wasm32'));
    const abis = Object.keys(inventory?.nativeByABI ?? {}); if (abis.length) rows.push(row('APK ABIs', abis.sort().join(', ')));
    if (state.currentSource?.name) rows.push(row('File', state.currentFileBytes ? `${formatSize(state.currentFileBytes)}` : '—', { note: state.currentSource.name }));
    const hint = document.createElement('p'); hint.textContent = 'Hold the app\'s icon on the home screen for the Package window (activities, permissions, splits).';
    panel.replaceChildren(...rows, hint);
  }
  function place() {
    if (panel.hidden) return;
    const box = button.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight, margin = 8;
    const left = Math.max(margin, Math.min(innerWidth - width - margin, box.left)), above = box.top - height - 6;
    panel.style.left = `${Math.round(left)}px`; panel.style.top = `${Math.round(above >= margin ? above : box.bottom + 6)}px`;
  }
  let leaving = null, pinned = false;
  const show = on => { panel.hidden = !on; button.setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) { fill(); place(); } else pinned = false; };
  const enter = () => { clearTimeout(leaving); show(true); }, leave = () => { if (pinned) return; clearTimeout(leaving); leaving = setTimeout(() => show(false), 150); };
  button.addEventListener('mouseenter', enter); button.addEventListener('mouseleave', leave); panel.addEventListener('mouseenter', enter); panel.addEventListener('mouseleave', leave);
  button.addEventListener('focus', enter); button.addEventListener('blur', () => { pinned = false; leave(); });
  button.addEventListener('click', () => { pinned = !pinned || panel.hidden; show(pinned); });   // a tap (touch) keeps it open until the next tap or Esc
  button.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); pinned = false; show(false); } });
  window.addEventListener?.('resize', place); window.addEventListener?.('scroll', place, true);
  return {
    render() {
      const times = state.loadTimes;
      if (!state.inventory || !times?.done || state.opening) { button.hidden = true; show(false); return; }   // while the app opens the status line has its clock; the time comes once, for the whole open
      const text = `${appLabel()} · ${times.totalMs !== undefined ? `opened in ${seconds(times.totalMs)}` : times.launchMs !== undefined ? `opened in ${seconds(times.launchMs)}` : `loaded in ${seconds(times.loadMs)}`}`;   // one time: the whole open when it was one (APK read and Activity started), else what this run did
      button.hidden = false; button.querySelector('.app-info-text').textContent = text; button.setAttribute('aria-label', `${text}. Details on hover or focus.`); button.title = '';
      if (!panel.hidden) { fill(); place(); }
    },
    hide() { button.hidden = true; show(false); },
  };
})();
function onWorkerProgress(progress = {}) {
  notePhase(progress.phase);
  const phases = { 'framework-resources': 'Loading original Android styles data', framework: 'Loading compiled AOSP code', manifest: 'Reading the manifest', dex: 'Inspecting DEX', native: 'Taking inventory of native libraries', complete: 'Inspection complete', launch: 'Trying to start the Activity', intent: 'Opening the link', click: 'Running DEX callback', back: 'Returning to the previous Activity', resources: 'Reading resources and XML layouts' };
  const message = `${phases[progress.phase] || 'Processing in the Worker'}${progress.filename ? ` · ${progress.filename}` : ''}`;
  if (state.opening) return;   // an opening says only what stage it is in (openingStage); the phases are in the load times and the execution log
  $('operation-message').textContent = message; if (state.bootVisible) setBootCaption(message);
  const bar = $('operation-progress');
  if (progress.total > 0) { bar.max = progress.total; bar.value = progress.completed || 0; }
  else bar.removeAttribute('value');
  if (state.mode === 'apk') setStatus(message);
}
function cancelOperation({ keepOpening = false } = {}) {   // keepOpening: the VM is replaced inside an opening that goes on (a launch reopening its APK): its screen and clock stay
  ++state.operation; state.abortController?.abort(); apkVM.cancel(); setTimeout(() => apkVM.prewarm?.(), 0); state.apiGaps = null; pluginHost.vmChanged();   // the next APK starts in a Worker that is already warming
  state.viewSession++; resetWebViews(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear(); state.runtime = null; state.apkRunning = false; state.canGoBack = false; state.lastAPKError = null;
  clearInterval(state.operationTimer);
  if (!keepOpening) { $('operation-panel').hidden = true; state.opening = null; state.paletteAfterOpen = null; dropBoot(); state.homeMode = 'idle'; showDeviceHome('idle'); }
  setBusy(false);
  if (state.mode === 'apk') { hideError(); setStatus('VM ended · reopen the APK to continue'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> CANCELED'; }
}
// ---- App data persistence (src/app-data-store.js): the toggle, the usage line and Clear storage.
function showAppData(info) {
  const element = $('app-data-usage'); if (!element) return;
  if (!info) { element.textContent = 'App data: open an APK to see usage.'; return; }
  const cap = formatSize(info.limitBytes ?? 0), used = `${formatSize(info.bytes ?? 0)} of ${cap} · ${info.files ?? 0} file(s)`;
  element.textContent = info.enabled === false ? (info.reason === 'disabled' ? `Persistence is off for this run · stored: ${used}` : info.reason === 'storage-error' ? `The stored app data could not be read (${info.error}): this run started without it and stores nothing` : 'Persistence is unavailable in this browser (no IndexedDB).')
    : info.error ? `App data: error while saving (${info.error}) · ${used}` : info.overLimit ? `App data over the limit: the write was refused and the last saved state was kept · ${used}` : `App data stored: ${used}${info.restoredFiles ? ` · ${info.restoredFiles} restored` : ''}`;
}
apkVM.onAppData = showAppData;
// ---- microG's device data (src/app-data-store.js attachDeviceData, src/microg-data-panel.js): the status line and "Clear microG data".
function showMicrogData(statuses) { const element = $('dev-microg-data-status'); if (element) element.textContent = microgDataText(statuses, { loadedMicrog: !!state.runtime && state.loadedMicrog === true }); }
apkVM.onMicrogData = showMicrogData;
// ---- "Add Google account (microG)" (src/microg-account-panel.js, src/account-sessions.js addAccountFromSettings): Settings > Accounts > Add, done by the device; microG's sign-in screen opens on it.
function accountUi() { return state.microgAccount ??= { pending: false, outcome: null }; }   // on `state`: setBusy (above) runs before this part of the module
function microgAccountInputs() { let settings = null; try { settings = deviceState.settings; } catch { /* deviceState is created further down: setBusy may run first */ } return { busy: state.busy, running: !!state.runtime, loadedMicrog: state.loadedMicrog === true, checkin: settings?.microgServices?.checkin === true, relay: !!(settings && proxyInUse(settings).url) }; }
function showMicrogAccount() {
  const inputs = microgAccountInputs(), button = $('add-microg-account'), status = $('dev-microg-account-status');
  if (button) button.disabled = accountUi().pending || !canAddGoogleAccount(inputs);
  if (status) status.textContent = googleAccountText({ ...inputs, pending: accountUi().pending, outcome: accountUi().outcome });
}
apkVM.onMicrogAccount = outcome => {
  accountUi().pending = false; accountUi().outcome = outcome ?? null; showMicrogAccount();
  appendTrace(outcome?.ok ? 'Add Google account (microG): microG added a Google account' : `Add Google account (microG): no account added (${outcome?.error ?? 'no answer'})`);
};
$('add-microg-account')?.addEventListener('click', async () => {
  if (!canAddGoogleAccount(microgAccountInputs()) || accountUi().pending) return;
  try {
    const answer = await apkVM.addMicrogAccount();
    if (!answer?.started) { accountUi().outcome = { ok: false, error: answer?.reason === 'checkin-off' ? 'Device registration is off in microG' : 'microG is not running on this device' }; showMicrogAccount(); return; }
    accountUi().pending = true; accountUi().outcome = null; showMicrogAccount(); microgSettings.close();   // the sign-in screen is on the device: the dialog gets out of its way
    appendTrace('Add Google account (microG): microG\'s sign-in screen opens on the device (Settings > Accounts > Add account); the credentials typed there go to Google through the relay');
    setStatus('microG\'s sign-in screen is open on the device');
  } catch (error) { reportAPKError(error, 'Could not start Add Google account', { crash: false }); }
});
$('clear-microg-data')?.addEventListener('click', async () => {
  if (!canClearMicrogData({ busy: state.busy, running: !!state.runtime, loadedMicrog: state.loadedMicrog })) return;
  if (!await modalHost.ask({ title: 'Delete microG data?', message: 'Delete microG\'s stored data on this device (its device registration, Google accounts, settings and databases)? It is shared by every app opened with microG. The running app keeps going until the APK is reopened.', confirmLabel: 'Delete', danger: true })) return;
  try { const statuses = await apkVM.clearMicrogData(); showMicrogData(statuses); appendTrace('microG data deleted (stored device data of com.google.android.gms and com.android.vending); reopen the APK to start microG from scratch.'); setStatus('microG data deleted · reopen the APK to start microG from scratch'); }
  catch (error) { reportAPKError(error, 'Could not clear the microG data', { crash: false }); }
});
apkVM.onApiGaps = report => { state.apiGaps = report; };
// Page plugins (docs/PLUGINS.md, src/plugin-host.js): each enabled plugin runs in its own Worker and only reads. With no plugin running nothing here does any work.
let pluginsPanel = null;
let mcpLink = null;
const modalHost = createModalHost();   // src/lab-modal.js: plugin screens (lab.modal) and "Expand" on a plugin card
const pluginModals = new Map();   // modal id -> { modal, pluginId }
/** What a plugin may do with the lab (src/plugin-host.js ACTION_METHODS): the page's own controls, which show in Controls and in the Logcat like the user's. */
let methodHooksPanel = null, codeTool = null;   // "App modified" (src/method-hooks-panel.js) and the Code tool (src/code-tool-loader.js): made with the Controls panels below
const debugActions = { code: (caller, args) => codeTool.actions.code(caller, args), debug: (caller, args) => codeTool.actions.debug(caller, args) };   // lab.code / lab.debug (src/debugger-plugin-actions.js, loaded on the first call): the Code browser's reads and edits, the page's debugger session
const pluginActions = {
  code: (plugin, args) => debugActions.code(plugin, args),
  debug: (plugin, args) => debugActions.debug(plugin, args),
  /** lab.hook / lab.unhook / lab.hooks (src/method-hooks.js): a method change chosen by the user, installed between two VM events and listed on the page as "App modified". */
  hook(plugin, spec) { if (!methodHooksPanel) throw Object.assign(new Error('lab.hook is not available here.'), { code: 'unsupported' }); return methodHooksPanel.add(plugin, spec); },
  unhook(plugin, { id }) { if (!methodHooksPanel) throw Object.assign(new Error('lab.unhook is not available here.'), { code: 'unsupported' }); return methodHooksPanel.remove(id, { owner: plugin.id }); },
  hooks(plugin, { all = false } = {}) { return methodHooksPanel ? methodHooksPanel.list({ owner: all ? null : plugin.id }) : []; },
  /** lab.adb: an adb command line run by the page's interpreter, as the adb terminal runs it (no files of the computer: a plugin runs in a sandboxed Worker). */
  async adb(plugin, { command = null, args = null } = {}) {
    const result = await runAdb(`plugin ${plugin.name}`, Array.isArray(args) && args.length ? { args } : { command: String(command ?? '') });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code, notes: result.notes ?? [], images: (result.images ?? []).map(image => ({ blob: image.blob, type: image.type })) };
  },
  async reload(plugin, { mode }) {
    if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('No app is running to reload.'), { code: 'no-apk' });
    await reloadActivity(mode === 'reopen' ? 'reopen' : 'recreate'); const screen = await pluginHost.query('screen', {}).catch(() => null);
    return { mode: mode === 'reopen' ? 'reopen' : 'recreate', activity: screen?.activity ?? null };
  },
  mock(plugin, spec) {
    // a stable id per method + full URL (or the caller's own id), so two endpoints of one host never replace each other
    const hash = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
    const key = spec.id !== undefined && spec.id !== null && String(spec.id) ? String(spec.id).replace(/[^\w-]+/g, '-').slice(0, 24) : `${String(spec.method ?? 'ANY').toLowerCase()}-${hash(`${String(spec.method ?? 'ANY').toUpperCase()} ${spec.url ?? ''}`)}`, owner = String(plugin.id).replace(/[^\w-]+/g, '').slice(-10);
    const result = mocksPanel.upsert({ ...spec, id: `p${owner}-${key}`.slice(0, 40), name: spec.name ?? `plugin ${plugin.name}`, enabled: spec.enabled !== false });
    if (result.errors.length) throw Object.assign(new Error(result.errors.map(error => error.message).join(' ')), { code: 'bad-args' });
    return { id: result.id };
  },
  unmock(plugin, { id }) { return { removed: mocksPanel.remove(String(id)) }; },
  /** lab.route / unroute / routes and a held request's decision (src/plugin-net-routes.js): the plugin's network routes, listed in the trace, the network log and the Resumo. */
  async route(plugin, args = {}) {
    if (args.op === 'add') return netRoutes.add(plugin, args);
    if (args.op === 'remove') return netRoutes.remove(plugin, args.id);
    if (args.op === 'list') return netRoutes.list(plugin.id);
    if (args.op === 'decide') return netRoutes.decide(plugin, args);
    throw Object.assign(new Error(`Unknown route operation: ${String(args.op).slice(0, 20)}`), { code: 'bad-args' });
  },

  /** lab.renderVariant (src/render-variant.js): one operation of the page like a click, so the user's input waits for it; nothing of the background instance is drawn here. */
  async renderVariant(plugin, options) {
    if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('No app is running.'), { code: 'no-apk' });
    if (state.busy) throw Object.assign(new Error('The VM is busy with another operation; try again.'), { code: 'busy' });
    await flushPendingInputs(); if (state.busy) throw Object.assign(new Error('The VM is busy with another operation; try again.'), { code: 'busy' });
    const token = beginOperation(`Rendering a variant of the screen in the background (plugin ${plugin.name})…`);
    try { return await state.runtime.renderVariant(options); } finally { finishOperation(token); }
  },
  mocks() { return mocksPanel.list(); },
  modal(plugin, args) {
    const entry = args.id ? pluginModals.get(String(args.id)) : null;
    if (args.op === 'open') {
      const modal = modalHost.open({ title: args.title || plugin.name, size: args.size, html: args.html ?? '', label: `plugin ${plugin.name}`,
        onMessage: data => pluginHost.emit(plugin.id, 'modal', { id: modal.id, type: 'message', data }),
        onClose: reason => { pluginModals.delete(modal.id); pluginHost.emit(plugin.id, 'modal', { id: modal.id, type: 'closed', reason }); } });
      pluginModals.set(modal.id, { modal, pluginId: plugin.id }); return { id: modal.id };
    }
    if (!entry || entry.pluginId !== plugin.id) throw Object.assign(new Error('Modal closed or unknown.'), { code: 'not-found' });
    if (args.op === 'update') { if (args.title !== undefined) entry.modal.setTitle(args.title); if (args.size !== undefined) entry.modal.setSize(args.size); if (args.html !== undefined) entry.modal.setHtml(args.html); return { id: entry.modal.id }; }
    if (args.op === 'post') { entry.modal.post(args.data); return { id: entry.modal.id }; }
    if (args.op === 'close') { entry.modal.close('code'); return { id: entry.modal.id }; }
    throw Object.assign(new Error(`unknown op: ${args.op}`), { code: 'bad-args' });
  },
};
// Plugin side tabs (src/lab-side-tabs.js), the drag from a tab onto the device (src/lab-drag.js: positions from the screen's live rectangle) and scrolling a scrollable to
// a position or percentage through the app's own scroll paths (src/lab-scroll.js: the ScrollBy action / View.scrollBy the wheel uses).
const labDrag = createDragLayer({ elements: () => pluginHost.query('layoutBounds', { names: false }), getDevice: () => {
  const element = $('android-screen'), frame = deviceState.bars?.contentFrame; if (!element || $('android-device')?.hidden) return null;
  return { element, width: deviceState.bars?.widthDp ?? element.clientWidth, height: deviceState.bars?.heightDp ?? element.clientHeight, density: 1, origin: { x: frame?.left ?? 0, y: frame?.top ?? 0 } };
} });
const sideTabs = createSideTabHost({ drag: labDrag });
const labScroll = createLabScroll({ query: args => pluginHost.query('scrollState', args), elements: () => pluginHost.query('layoutBounds', { names: false }), views: () => flattenViews(state.lastSnapshot),
  async scrollBy(target, dx, dy) {
    if (target.kind === 'compose') deviceView.queueComposeAction(target.ownerViewId, target.nodeId, 'ScrollBy', [dx, dy]);
    else { const previous = state.pendingScrollBys.get(target.id) ?? { dx: 0, dy: 0 }; state.pendingScrollBys.set(target.id, { dx: previous.dx + dx, dy: previous.dy + dy }); }
    await flushPendingInputs();
  },
  async scrollToIndex(target, index) { deviceView.queueComposeAction(target.ownerViewId, target.nodeId, 'ScrollToIndex', [index]); await flushPendingInputs(); } });
// lab.highlight (src/lab-highlight.js): outlines around components a plugin named by id, over the device screen, matched again against every drawn frame
const labHighlights = createHighlightLayer({ root: () => $('lab-highlight-layer'), getOrigin: () => { const frame = deviceState.bars?.contentFrame; return { x: frame?.left ?? 0, y: frame?.top ?? 0 }; },
  elements: () => state.lastSnapshot ? buildLayoutBoundsElements(null, state.lastSnapshot).map(layoutBoundsElementOut) : [] });
pluginActions.highlight = createHighlightAction(labHighlights);
// lab.on('frame') / lab.frame(), lab.track and lab.overlay (src/lab-overlays.js): where the device's screen is on the page, components followed frame by frame, and the plugin's
// HTML beside or over the device. The page's own geometry (the screen's rectangle and the elements of the drawn frame); nothing runs without overlays, tracks or listeners.
function deviceGeometry() {
  const screen = $('android-screen'), device = $('android-device'); if (!screen || !device || device.hidden || !screen.offsetWidth) return null;
  const bars = deviceState.bars;
  return frameGeometry({ rect: screen.getBoundingClientRect(), size: { width: screen.offsetWidth, height: screen.offsetHeight }, frame: bars?.contentFrame ?? null, viewport: { width: window.innerWidth, height: window.innerHeight }, orientation: bars?.orientation ?? null, visible: !$('preview-stage')?.hidden });
}
const labOverlays = createOverlayHost({ layer: () => $('lab-overlay-layer'), geometry: deviceGeometry, elements: () => state.lastSnapshot ? buildLayoutBoundsElements(null, state.lastSnapshot).map(layoutBoundsElementOut) : [], onFrame: geometry => pluginHost.frame(geometry) });
const overlayActions = createOverlayAction({ host: labOverlays, emit: (id, name, data) => pluginHost.emit(id, name, data) });
Object.assign(pluginActions, { overlay: overlayActions.overlay, track: overlayActions.track, frame: () => overlayActions.frame() ?? { visible: false, screen: null, window: null, scale: null, device: null, windowDp: null, viewport: { width: window.innerWidth, height: window.innerHeight }, orientation: null } });
/** lab.invoke (src/app-invoke.js): one of the app's methods on its main thread, as an operation of the page like a click (the user's input waits for it; it shows in the operation bar). */
pluginActions.invoke = async (plugin, args) => {
  if (state.runtime !== apkVM || !state.apkRunning) throw Object.assign(new Error('No app is running: open an APK (it opens when loaded) or tap its icon on the home screen.'), { code: 'no-apk' });
  await flushPendingInputs(); await waitIdle(10000);
  if (state.busy || apkVM.pending) throw Object.assign(new Error('The VM is busy with another operation; try again.'), { code: 'busy' });
  const token = beginOperation(`Calling ${String(args.method ?? '').slice(0, 60)}() (plugin ${plugin.name})…`);
  let reply;
  try { reply = await apkVM.invokeMethod({ handle: args.handle, className: args.className, method: args.method, signature: args.signature, args: Array.isArray(args.args) ? args.args : [] }); }
  finally { finishOperation(token); }
  if (reply.snapshot) renderSnapshot(reply.snapshot);
  const invocation = reply.invocation ?? {};
  if (invocation.error) throw Object.assign(new Error(invocation.error.message), { code: invocation.error.code ?? 'failed' });
  if (invocation.exception) { appendTrace(`Plugin ${plugin.name}: ${invocation.method} threw ${invocation.exception.type}`); throw Object.assign(new Error(`${invocation.method} threw ${invocation.exception.type}${invocation.exception.message ? ': ' + invocation.exception.message : ''}`), { code: 'exception', exception: invocation.exception }); }
  appendTrace(`Plugin ${plugin.name}: ${invocation.method} in ${invocation.ms} ms`);
  return invocation;
};
const labScrollCall = (method, args) => { if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('No app is running: open an APK (it opens when loaded) or tap its icon on the home screen.'), { code: 'no-apk' }); return labScroll[method](args ?? {}); };
Object.assign(pluginActions, { tab: createTabAction({ tabs: sideTabs, emit: (id, event) => pluginHost.emit(id, 'tab', event) }), scrollTo: (plugin, args) => labScrollCall('scrollTo', args), scrollInfo: (plugin, args) => labScrollCall('info', args) });
/** The Compose semantics tree of the last frame was paced behind the screen (snapshot.composeSemanticsStale): the Worker answers a fresh snapshot, drawn like any other (the layer of controls follows it). */
async function freshenSemantics() {
  if (!state.runtime || !state.apkRunning || state.busy || state.runtime !== apkVM || typeof apkVM.refreshSemantics !== 'function') return;
  const token = state.operation; if (state.inputPromise) await state.inputPromise.catch(() => {});   // input already on its way answers first (one VM operation at a time)
  if (state.busy || token !== state.operation) return;
  const snapshot = await apkVM.refreshSemantics();
  if (snapshot && token === state.operation && state.runtime === apkVM) renderSnapshot(snapshot);
}
const pluginHost = createPluginHost({ vm: apkVM, actions: pluginActions, freshen: freshenSemantics, getPackage: () => state.inventory?.packageName ?? null, captureImage: request => captureImage({ ...request, getHost: id => state.viewElements.get(String(id)) ?? null }), onChange: id => { pluginsPanel?.changed(id); if (!pluginHost?.get?.(id)?.worker) { for (const [modalId, entry] of pluginModals) if (entry.pluginId === id) entry.modal.close('stopped'); sideTabs.closeOwner(id, 'stopped'); labHighlights.closeOwner(id); labOverlays.closeOwner(id); } }, onLogStreaming: () => { syncLogcatStreaming().catch(() => {}); }, onFrameWatch: on => labOverlays.setFrameWatch(on),
  onStopped: id => { netRoutes.removeOwner(id).catch(error => appendTrace(`Plugin network routes of a stopped plugin could not be removed: ${error?.message ?? error}`)); methodHooksPanel?.removeOwner(id).catch(error => appendTrace(`App modified: the changes of a stopped plugin could not be removed: ${error?.message ?? error}`)); codeTool?.removeOwner(id).catch(() => {}); } });   // a plugin's session ended: its method changes, file edits and breakpoints go with it
window.apkLabPlugins = pluginHost;   // test and console access: .list(), .stats
window.apkLabVM = apkVM;   // test and console access: await apkLabVM.screenState() is the text Copy diagnostics copies
window.apkLabOpen = (url, name = String(url).split('/').pop()) => importSource({ name, url: new URL(url, location.href).href }, true);   // test and console access: open and run an APK by URL (scripts/capture-plugin-examples.mjs)
// The Worker streams Logcat lines while the Logcat panel is open or a running plugin listens to 'log'; opening the panel always asks again (it shows the ring's recent lines).
let logcatPanelOpen = false, logcatStreamingSent = false;
function syncLogcatStreaming(force = false) {
  const wanted = logcatPanelOpen || pluginHost.wantsLogs || !!mcpLink?.connected; if (!force && wanted === logcatStreamingSent) return Promise.resolve();
  logcatStreamingSent = wanted; return apkVM.setLogcatStreaming(wanted);
}
const logcatPanel = createLogcatPanel({ root: $('logcat'), getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app', setStreaming: open => { logcatPanelOpen = !!open; return syncLogcatStreaming(!!open); } });   // src/logcat-panel.js; closed, the Worker keeps the lines in its ring and posts only a counter
const composeInspector = createComposeInspectorPanel({ root: $('compose-inspector'), inspect: () => apkVM.inspectCompose(), recompositions: { sync: on => apkVM.syncRecompositions(on), reset: () => apkVM.resetRecompositions() }, getSnapshot: () => state.apkRunning ? state.lastSnapshot : null, getHost: id => state.viewElements.get(String(id)) ?? null, getScreen: () => $('android-screen'),
  domImage: async (element, canvas) => { const host = state.viewElements.get(String(element.id)) ?? null; if (!drawnByDom(element, host)) return false; await renderDomElement(host, canvas, { limit: 720 }); return true; },   // an XML View the page draws with its DOM
  resourceNames: ids => adbDevice.resourceNames(ids) });   // src/compose-inspector-panel.js: nothing runs while it is closed
apkVM.onRecompositions = update => composeInspector.recomposed(update);
window.apkLabComposeInspector = composeInspector;   // test and console access: .state
apkVM.onLogcat = message => { logcatPanel.push(message); pluginHost.logcat(message); };
const netlogPanel = createNetlogPanel({ openModal: options => modalHost.open(options), root: $('netlog'), getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app', getAllowedHosts: () => deviceState.settings.network.allowedHosts,
  allowHost: host => { if ($('dev-hosts-all').checked) return; $('dev-hosts').value = addAllowedHost($('dev-hosts').value, host); $('dev-hosts').dispatchEvent(new Event('input')); },
  // right click on a request: a mock of it (the dialog opens filled; nothing is saved until Save) or a host redirect rule with that origin
  createMock: entry => {
    const skip = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'date', 'set-cookie', 'vary', 'age', 'server', 'alt-svc', 'strict-transport-security']);
    let url = entry.url; try { const parsed = new URL(entry.url); url = `${parsed.origin}${parsed.pathname}`; } catch { /* kept as is */ }
    const headers = (entry.responseHeaders ?? []).filter(([name]) => !skip.has(String(name).toLowerCase())).map(([name, value]) => ({ name, value }));
    mocksPanel.openPrefilled({ name: `${entry.method} ${entry.host}${entry.path?.split('?')[0] ?? ''}${entry.responseBodyTruncated ? ' (body cut at 48 KB)' : ''}`.slice(0, 120), method: entry.method,
      url, status: entry.status ?? 200, reason: entry.reason ?? '', headers: headers.length ? headers : [{ name: 'Content-Type', value: entry.contentType ?? 'application/json' }], body: entry.responseBody ?? '' });
  },
  // "Ignore this endpoint" / "Ignore this host": a rule of Controls › Network › Blocked calls (src/blocked-calls.js); the same entry takes it off again
  blockCalls: { has: (scope, entry) => blockedPanel.has(scope, entry), toggle: (scope, entry) => { for (const id of ['control-panel', 'cp-sec-network']) { const section = $(id); if (section) section.open = true; } return blockedPanel.toggle(scope, entry); } },
  redirectHost: entry => {
    for (const id of ['control-panel', 'cp-sec-network']) { const section = $(id); if (section) section.open = true; }   // the Controls card and the section, so the destination field can take the focus
    hostMapPanel.addRule(`${entry.scheme ? entry.scheme + '://' : ''}${entry.host}${entry.port && ![80, 443].includes(Number(entry.port)) ? ':' + entry.port : ''}`);
  } });   // src/netlog-panel.js; "Allow" types the host into the Device field, the same path as typing it
apkVM.onNetlog = message => { netlogPanel.push(message); pluginHost.netlog(message); };
apkVM.onMethodHookCalls = message => pluginHost.hookCalls(message);
const netRoutes = createPluginNetRoutes({ vm: apkVM, deliver: (id, message) => pluginHost.routeMessage(id, message), record: text => appendTrace(text) });   // lab.route (src/plugin-net-routes.js)
apkVM.onNetRoute = message => netRoutes.fromVm(message);   // observed calls (lab.hook { observe }): each batch to the plugin that observes
const glSurfaces = createGlSurfaces();   // OpenGL ES window surfaces of the app (src/gles-native.js -> src/gl-surfaces.js)
apkVM.onGlFrame = frame => glSurfaces.frame(frame);
window.apkLabNetlog = netlogPanel;   // test and console access: .store.entries
window.apkLabLogcat = logcatPanel;   // test and console access: .store.entries
try { if (localStorage.getItem('apkweb.keepAppData') === '0') $('keep-app-data').checked = false; } catch { /* storage may be blocked */ }
$('keep-app-data')?.addEventListener('change', () => { try { localStorage.setItem('apkweb.keepAppData', $('keep-app-data').checked ? '1' : '0'); } catch { /* ignore */ } setStatus($('keep-app-data').checked ? 'App data will be kept from the next time the APK is opened.' : 'App data will not be read or written from the next time the APK is opened.'); });
$('clear-app-data')?.addEventListener('click', async () => {
  if (state.busy || !state.runtime) return;
  if (!await modalHost.ask({ title: 'Delete app data?', message: 'Delete all the data stored by this app (preferences, databases and files)? The app will be restarted.', confirmLabel: 'Delete', danger: true })) return;
  try { const info = await apkVM.clearAppData(); showAppData(info); appendTrace('App data deleted (like Settings > Apps > Clear storage).'); if (state.currentSource) await importSource(state.currentSource); setStatus('App data deleted · open the app again to start from scratch'); }
  catch (error) { reportAPKError(error, 'Could not clear the app data', { crash: false }); }
});
// Page hidden or closing: ask the Worker to store the app data right away (best effort; the write is already a transaction by the time the page goes).
document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') apkVM.flushAppData(); });
globalThis.addEventListener?.('pagehide', () => apkVM.flushAppData());
// Crash recorder: while an APK runs, the page keeps the latest state in localStorage every few seconds and marks the run as ended when the page goes away normally (pagehide). If the browser
// kills the tab (out of memory) none of that runs, so the next load finds a run that never ended and offers the last recorded state, which is all that survives such a crash.
const LAST_RUN_KEY = 'apkweb.lastRun';
const lastRunStore = { read() { try { return JSON.parse(globalThis.localStorage?.getItem(LAST_RUN_KEY) ?? 'null'); } catch { return null; } }, write(value) { try { globalThis.localStorage?.setItem(LAST_RUN_KEY, JSON.stringify(value)); } catch { /* storage full or blocked: the recorder is best effort */ } }, clear() { try { globalThis.localStorage?.removeItem(LAST_RUN_KEY); } catch { /* best effort */ } } };
let recorderSawWorker = false;   // only a page that ran a VM may close a record: a fresh page must leave a crashed run's record for showPreviousCrash
function recordLastRun() {
  if (!apkVM.worker) { if (recorderSawWorker) { recorderSawWorker = false; markLastRunEnded(); } return; }
  recorderSawWorker = true;   // the VM ended in a way the page knows about (Terminate, an error, a timeout): not a crash
  const health = state.lastVmHealth, beat = apkVM.lastHeartbeat, text = apkVM.lastScreenSnapshot?.text ?? null, heap = globalThis.performance?.memory;
  lastRunStore.write({ v: 1, ended: false, at: Date.now(), startedAt: state.runStartedAt ?? Date.now(), page: location.href.split('#')[0], package: state.inventory?.packageName ?? null, mode: state.mode,
    pageHeapMiB: heap ? Math.round(heap.usedJSHeapSize / 1048576) : null, pageHeapLimitMiB: heap ? Math.round(heap.jsHeapSizeLimit / 1048576) : null, deviceMemoryGiB: globalThis.navigator?.deviceMemory ?? null,
    vm: health ? { objects: health.liveObjects, limit: health.limit, collections: health.collections, gcMs: health.gcMs, lastEventMs: health.lastEventMs, oom: health.oomCount } : null,
    beat: beat ? { operation: beat.operation, thread: beat.thread, stack: (beat.stack ?? []).slice(0, 6), hostCall: beat.hostCall, events: beat.events, instructions: beat.instructions, queueDepth: beat.queueDepth, vm: beat.vm ?? null, ageMs: Date.now() - (apkVM.lastHeartbeat?.receivedAt ?? Date.now()) } : null,
    status: $('status-text')?.textContent ?? '', screen: text ? text.slice(0, 24000) : null });
}
function markLastRunEnded() { const last = lastRunStore.read(); if (last && last.ended === false) lastRunStore.write({ ...last, ended: true, endedAt: Date.now() }); }
{ const recorder = setInterval(recordLastRun, 3000); recorder?.unref?.(); }   // unref: a page has no use for it, and a test that loads this file must still be able to exit
globalThis.addEventListener?.('pagehide', () => { if (recorderSawWorker) markLastRunEnded(); });
function showPreviousCrash() {
  const last = lastRunStore.read(); if (!last || last.ended !== false || Date.now() - last.at > 24 * 3600 * 1000) return;
  const seconds = Math.round((last.at - last.startedAt) / 1000), lines = ['Last run interrupted without warning', `Package: ${last.package ?? '?'} · mode ${last.mode ?? '?'} · ran about ${seconds} s before the last record (${new Date(last.at).toLocaleString()}).`,
    last.pageHeapMiB != null ? `Page JS heap at the last record: ${last.pageHeapMiB} MiB of ${last.pageHeapLimitMiB} MiB (only Chrome reports it; the VM Worker is not counted).` : 'Page JS heap: unavailable in this browser.',
    last.deviceMemoryGiB != null ? `Device memory reported by the browser: ${last.deviceMemoryGiB} GiB.` : '',
    last.vm ? `VM: ${last.vm.objects} of ${last.vm.limit} live objects, ${last.vm.collections} collections (${last.vm.gcMs} ms), last event ${last.vm.lastEventMs} ms${last.vm.oom ? `, ${last.vm.oom} OutOfMemoryError` : ''}.` : '',
    last.beat ? `Last VM signal (${Math.round(last.beat.ageMs / 1000)} s before the record): ${last.beat.operation ?? 'no operation'}, thread ${last.beat.thread ?? '?'}, ${last.beat.stack.join(' < ') || 'no stack'}, host call: ${last.beat.hostCall ?? 'none'}, ${last.beat.events} events, ${last.beat.instructions} instructions, queue ${last.beat.queueDepth}.` : '',
    `Page status: ${last.status}`, 'Possible causes: the browser ended the tab for lack of memory (the most common), the tab was force-reloaded or the computer went to sleep. None of these raises an error inside the page.', last.screen ? `\n${last.screen}` : ''].filter(Boolean);
  const banner = document.createElement('div'); banner.className = 'crash-notice'; banner.setAttribute('role', 'alert');
  const text = document.createElement('span'); text.textContent = 'The last run stopped without warning (probably the browser ran out of memory).';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy the last state';
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(lines.join('\n')); copy.textContent = 'Copied'; } catch { $('trace-output').textContent = lines.join('\n'); $('trace').open = true; copy.textContent = 'See the execution log'; } });
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Dismiss'; close.addEventListener('click', () => { lastRunStore.clear(); banner.remove(); });
  banner.append(text, copy, close); document.body.prepend(banner);
}
showPreviousCrash();
function formatSize(size) {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
/** The limits found in the file, under the drop zone (the package's details are in the home-screen icon's Package window). */
function showInventory(inventory) {
  const unsupported = inventory.unsupportedFeatures || [];
  $('unsupported-notice').hidden = !unsupported.length;
  $('unsupported-list').replaceChildren(...unsupported.map((item) => { const li = document.createElement('li'); li.textContent = item; return li; }));
}
async function importSource(source, autoRun = false) {
  const sameApp = state.currentSource === source, ongoing = autoRun ? null : state.opening, left = ['home', 'overview'].includes(taskSwitcher?.state?.());   // left: the user went to the launcher or the recents during the open   // ongoing: the opening of a launch that reopens its APK (runAPKOnce)
  // Another APK (a file, a launcher icon, an example) while one loads or runs: the current VM is ended first, with no button for it (the new load would end it too; this also drops the operation in flight).
  if (state.busy || state.runStarting) { cancelOperation({ keepOpening: !!ongoing }); state.runStarting = false; }
  state.reimportShelfId = null;   // set again if this load fails for an installed app
  state.currentSource = source; state.launchAttempted = false; state.lastAPKError = null; state.stickyError = false; state.needsRestart = false; state.viewSession++; resetWebViews(); for (const id of ['android-content', 'android-window-layer', 'android-action-mode-layer']) for (const child of [...($(id)?.children || [])]) child.remove(); state.viewElements.clear(); state.shadowElements.clear(); state.windowSurfaceElements.clear(); $('android-window-layer')?.replaceChildren?.(); state.composeElements.clear(); state.nativeOverlayElements.clear(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  glSurfaces.reset(); permissionsPanel?.detach(); filesPanel?.detach(); appDataPanel?.reset(); cameraLab?.detach(); microgEntriesPanel?.reset(); overridesPanel?.detach(); methodHooksPanel?.vmEnded(); codeTool?.vmEnded(); ignoredPanel?.detach(); mocksPanel?.detach(); blockedPanel?.detach(); hostMapPanel?.resetHits(); pluginHost.vmChanged();
  orientationLock.reset();   // no Activity on top until the new run has one
  // A new run (another APK, or the app opened again from its launcher icon) starts clean: the Worker of the previous run is terminated by apkVM.load, and what the page still shows of it goes too
  // (Logcat, network requests, memory meter, error report, last frame and heartbeat). App data follows the "Keep app data" option; the panel settings are kept.
  logcatPanel.reset(); netlogPanel.reset(); composeInspector.reset(); state.oomSeen = 0; state.lastVmHealth = null; showClientCertState(); state.lastSnapshot = null; state.errorReport = null; apkVM.lastHeartbeat = null; apkVM.lastScreenSnapshot = null; if ($('memory-meter')) $('memory-meter').hidden = true;
  taskSwitcher?.reset(); switchMode('apk'); hideError(); state.runtime = null; state.inventory = null; state.apkRunning = false; state.canGoBack = false;
  $('empty-preview').querySelector('h2').textContent = 'Your app starts here.'; $('empty-preview').querySelector('p').innerHTML = emptyPreviewHint();
  const opening = autoRun ? beginOpening() : ongoing;   // opened right away (a new clock), or reopened by a launch (its clock): the read is the first stage of the open
  if (opening) opening.stage = 'read';
  const token = beginOperation(opening ? OPENING_MESSAGE.read : 'Reading the APK…');
  $('unsupported-notice').hidden = true;
  $('preview-name').textContent = source.name;
  if (opening) { if ((autoRun || !left) && taskSwitcher && deviceView) { showDeviceFrame(); taskSwitcher.launching({ label: source.name, fresh: !sameApp }); } showBoot(OPENING_MESSAGE.read); setStatus(OPENING_MESSAGE.read); }   // (the reset above put the launcher back: the starting window again, unless the user had left it)   // its starting window at once, the read and the launch under it
  else showDeviceHome('installing', source.name);   // the app shows up on the launcher at once, under a spinner, while the package is read
  state.shelfId = source.shelfId ?? null; await refreshShelf();
  state.trace = []; appendTrace(`Opening ${source.name} in an isolated Web Worker. No upload.`);
  setStatus(opening ? OPENING_MESSAGE.read : 'Reading the APK…');
  try {
    let buffer; state.loadTimes = { startedAt: performance.now(), phases: [], readMs: 0, loadMs: 0 }; state.currentFileBytes = source.file?.size ?? null; appInfo.render();
    if (source.file) buffer = await source.file.arrayBuffer();
    else {
      state.abortController = new AbortController();
      const response = await fetch(source.url, { cache: 'no-store', signal: state.abortController.signal });
      if (!response.ok) throw new Error(`Could not load the APK (HTTP ${response.status}).`);
      if (Number(response.headers.get('Content-Length')) > 1024 * 1024 * 1024) throw new Error('The APK exceeds the 1 GiB limit.');
      buffer = await response.arrayBuffer();
    }
    if (token !== state.operation) return;
    if (buffer.byteLength > 1024 * 1024 * 1024) throw new Error('The APK exceeds the 1 GiB limit.');
    state.currentFileBytes = buffer.byteLength;
    state.loadTimes.readMs = Math.round(performance.now() - state.loadTimes.startedAt); state.loadTimes.loadStartedAt = performance.now();
    state.apiGaps = null;
    frameMeter.reset();   // the frame counts of "Show frame rate" start with the app
    await refreshRelay(); if (token !== state.operation) return;   // the relay found by itself is the device's proxy from the first request (src/relay-detect.js)
    state.runProxy = proxyInUse(); appendTrace(describeProxyForTrace(state.runProxy));
    state.runArm64 = deviceState.settings.arm64Native === true; state.runCustomIdentity = customIdentityForLoad(deviceState.settings); updateIdentityNote(); updateCustomIdentityHint();   // the ABI configuration of this run's device identity, and the custom identity the user typed (null: the lab's)
    const result = await apkVM.load(buffer, { onProgress: onWorkerProgress, device: vmDevice(deviceState.settings), tolerateMissing: $('tolerate-missing')?.value ?? 'off', nativeVersionMismatch: $('native-version-mismatch')?.checked === true, strictCrash: $('strict-crash')?.checked === true, keepData: $('keep-app-data')?.checked !== false, memoryMiB: deviceState.settings.memoryMiB, eventSeconds: deviceState.settings.eventSeconds, motionRaster: params.get('raster') !== 'full', rasterScale: deviceState.settings.raster?.motionScale ?? 1, rasterNavigation: deviceState.settings.raster?.navigation === true, rasterSettled: deviceState.settings.raster?.stillScale ?? 1, logcatStreaming: logcatPanel.streaming, renderer: deviceState.settings.renderer ?? 'cpu', engine: engineForLoad(), coreMemory: deviceState.settings.coreMemory, textScale: Math.min(4, Math.max(1, Math.ceil(globalThis.devicePixelRatio || 1))), arm64Native: deviceState.settings.arm64Native === true, arm64Translate: deviceState.settings.arm64Translate !== false, glesCpu: deviceState.settings.glesCpu === true, hardwareWindow: deviceState.settings.hardwareWindow !== false, schedulingOf25: deviceState.settings.schedulingOf25 === true, prepareFromLastRun: deviceState.settings.prepareFromLastRun !== false, microg: deviceState.settings.microg === true, microgServices: deviceState.settings.microgServices, customIdentity: state.runCustomIdentity, loadImage: deviceState.settings.loadImage === true }); state.loadedEngine = engineForLoad(); state.loadedMicrog = deviceState.settings.microg === true; updateMicrogHint(); showMicrogData(result.microgData ?? null); showRendererStatus(result.renderer); state.loadedMemoryMiB = deviceState.settings.memoryMiB; state.loadedCoreMemory = { ...deviceState.settings.coreMemory }; updateVmMemoryHint(); // Ownership transfers to the Worker.
    if (token !== state.operation) return;
    state.runtime = apkVM; state.inventory = result.inventory; showAppData(result.appData);
    { const times = state.loadTimes, last = times.phases.at(-1); if (last && !last.ms) last.ms = Math.round(performance.now() - last.at); times.loadMs = Math.round(performance.now() - times.startedAt); times.done = true; times.prepared = !!result.inventory.prepared; if (Array.isArray(result.loadTiming?.phases)) times.workerPhases = result.loadTiming.phases;
      showLoadTimes(); appendTrace(`Loaded in ${times.loadMs} ms: ${times.phases.filter(item => item.ms > 0).map(item => `${item.phase} ${item.ms} ms`).join(', ')}`); }
    await permissionsPanel.attach(result.inventory); await filesPanel.attach(); cameraLab.attach(); await overridesPanel.attach(result.inventory); await methodHooksPanel.attach(result.inventory); await codeTool.vmAttached(result.inventory); await ignoredPanel.attach(result.inventory); await mocksPanel.attach(result.inventory); await blockedPanel.attach(result.inventory); await netRoutes.attach().catch(error => appendTrace(`Plugin network routes could not be applied: ${error?.message ?? error}`)); pluginHost.vmChanged(); if (logcatPanelOpen || pluginHost.wantsLogs) syncLogcatStreaming(true).catch(() => {});   // before any app code runs: permission state, simulated location, method return overrides, ignored Activities, endpoint mocks
    showInventory(result.inventory); showDeviceHome('installed');
    if (source.file && apkShelf) {   // an APK from a file is kept on the home screen (one entry per package: a new build replaces the old one); a hosted example is not
      // The copy is written while the app starts, not before: the VM already holds the bytes, and writing a large APK took about a second (240 MB) that the launch waited for.
      // The entry's id is taken when the write ends, if this is still the APK of the run (another APK chosen meanwhile has its own).
      const inventory = result.inventory;
      apkShelf.save({ name: source.name, packageName: inventory.packageName || null, blob: source.file, handle: source.handle ?? null, previousId: source.shelfId ?? null })
        .then(saved => { source.shelfId = saved.id; if (state.currentSource !== source) return; state.shelfId = saved.id; describeSavedApp(); apkShelf.describe(saved.id, { activities: intentActivities(inventory) }).catch(() => {}); navigator.storage?.persist?.().catch(() => {}); },
          error => { if (state.currentSource === source) appendTrace(`Home screen: could not store the APK (${error?.message ?? error})`); })
        .then(() => refreshShelf());
    }
    appendTrace(`Package: ${result.inventory.packageName || '(not identified)'}`);
    if (state.mode === 'apk') {
      if (!opening || result.inventory.unsupportedFeatures?.length) setStatus(result.inventory.unsupportedFeatures?.length ? 'File inspected · see the file limits' : autoRun ? 'Installed · opening the app…' : 'Installed · tap its icon on the home screen to open it', result.inventory.unsupportedFeatures?.length ? 'error' : '');
      $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = `<span></span> ${result.inventory.unsupportedFeatures?.length ? 'FILE LIMIT' : 'INSPECTED'}`;
    }
  } catch (error) {
    if (token !== state.operation) return;
    state.homeMode = 'idle'; appInfo.render();
    // An installed app that failed to open keeps its icon on the launcher (it is not the app of a run any more: drawn as a saved app, to tap again), and the error offers to
    // choose its APK again, which replaces the stored copy. Before, the entry stayed "the app of this run", whose icon the idle launcher hides: the app vanished from the home screen.
    if (source.shelfId) { state.reimportShelfId = source.shelfId; state.shelfId = null; await refreshShelf(); }
    endOpening(opening); dropBoot(); showDeviceHome('idle'); reportAPKError(error, source.shelfId ? 'Could not open the installed app' : 'Could not inspect the APK', { crash: false });
  } finally { finishOperation(token); }
  if (token === state.operation && autoRun && state.runtime && !state.inventory?.unsupportedFeatures?.length) await runAPK();
  else if (autoRun) endOpening(opening);
}
/**
 * An Android App Bundle (.aab) chosen or dropped: the APK of its base module (src/aab-bundle.js, what bundletool's universal APK holds), as a File named .apk; an .apk is returned
 * as it is. What the conversion left out (other modules) is reported in the status line.
 */
async function bundleAsApk(file) {
  if (!/\.aab$/i.test(file.name)) return file;
  const { appBundleToApk } = await import('./aab-bundle.js?v=28012a33f717');
  const { bytes, notes } = appBundleToApk(new Uint8Array(await file.arrayBuffer()));
  if (notes.length) console.warn(`App Bundle ${file.name}: ${notes.join('; ')}`);
  return new File([bytes], file.name.replace(/\.aab$/i, '.apk'), { type: 'application/vnd.android.package-archive' });
}
async function chooseFile(file, handle = null) {   // handle: a FileSystemFileHandle (or a promise of one) where the browser gives it, kept with the saved app
  const replaces = state.pendingReplaceShelfId ?? null; state.pendingReplaceShelfId = null;   // "Choose the APK again" for an installed app: this file takes that entry's place
  if (!file) return;
  if (file.size > 1024 * 1024 * 1024) { switchMode('apk'); showError(new Error('This lab limits APKs to 1 GiB. Choose a smaller file to continue.'), 'APK above the size limit'); return; }
  if (!/\.(apk|aab|apks|xapk|apkm)$/i.test(file.name)) { switchMode('apk'); showError(new Error('Choose an .apk, .aab or a split-APK set (.apks / .xapk / .apkm).'), 'Invalid file format'); return; }
  let fileHandle = null; try { fileHandle = await handle; if (fileHandle?.kind !== 'file') fileHandle = null; } catch { fileHandle = null; }
  if (/\.aab$/i.test(file.name)) {   // the saved app keeps the converted APK, not a handle to the bundle
    try { file = await bundleAsApk(file); } catch (error) { switchMode('apk'); showError(error, 'This App Bundle could not be converted'); return; }
    fileHandle = null;
  }
  await importSource({ file, name: file.name, handle: fileHandle, ...(replaces ? { shelfId: replaces } : {}) }, true);   // installed and opened at once; the launcher keeps its icon to open it again
}
// Memory readout in the status bar: the memory in use (the Worker's measured memory plus, where the browser exposes it, the page's JS heap) and a bar of live VM objects against the
// object budget (the OutOfMemoryError threshold); the parts are in the hover panel (src/worker-memory.js memorySummary).
// One line with the total in use (Worker + page) and the Java heap bar; the details are a panel shown while the pointer is over the line (or it has the keyboard focus), redrawn
// with every new reading and every second while open, so the page heap moves live (src/worker-memory.js memorySummary).
const memoryView = { health: null, timer: null };
const pageHeap = () => globalThis.performance?.memory?.usedJSHeapSize ?? null;
function updateMemoryMeter(health) {
  const meter = $('memory-meter'); if (!meter || !health || !Number.isFinite(health.liveObjects) || !health.limit) return;
  memoryView.health = health;
  const summary = memorySummary(health, pageHeap());
  meter.hidden = false; meter.dataset.level = summary.level; meter.style.setProperty('--fill', `${Math.round(summary.ratio * 100)}%`);
  const bar = meter.querySelector('i'); if (bar) bar.hidden = !summary.limited;   // the bar is the Java objects against a fixed budget: the WebAssembly core has none
  const text = meter.querySelector('.memory-text'); if (text) text.textContent = summary.text;
  meter.setAttribute('aria-label', `${summary.text}. Details on hover or focus.`);
  if (!$('memory-detail')?.hidden) renderMemoryDetail(summary);
}
function renderMemoryDetail(summary = memoryView.health ? memorySummary(memoryView.health, pageHeap()) : null) {
  const panel = $('memory-detail'); if (!panel || !summary) return;
  const rows = summary.rows.map(row => {
    const line = document.createElement('div'); line.className = row.indent ? 'md-row md-sub' : 'md-row';
    const label = document.createElement('span'); label.textContent = row.label;
    const value = document.createElement('strong'); value.textContent = row.value;
    line.append(label, value);
    if (row.sub) { const sub = document.createElement('small'); sub.textContent = row.sub; line.append(sub); }
    return line;
  });
  const notes = summary.notes.map(note => { const p = document.createElement('p'); p.textContent = note; return p; });
  const live = document.createElement('p'); live.className = 'md-live'; live.textContent = `Live · ${new Date().toLocaleTimeString()}`;
  panel.replaceChildren(...rows, ...notes, live);
}
function placeMemoryDetail() {
  const meter = $('memory-meter'), panel = $('memory-detail'); if (!meter || !panel || panel.hidden) return;
  const box = meter.getBoundingClientRect(), width = panel.offsetWidth, height = panel.offsetHeight, margin = 8;
  const left = Math.max(margin, Math.min(innerWidth - width - margin, box.right - width)), above = box.top - height - 6;
  panel.style.left = `${Math.round(left)}px`; panel.style.top = `${Math.round(above >= margin ? above : box.bottom + 6)}px`;
}
function showMemoryDetail(on) {
  const panel = $('memory-detail'); if (!panel || !memoryView.health) return;
  clearInterval(memoryView.timer); memoryView.timer = null;
  panel.hidden = !on; if (!on) return;
  renderMemoryDetail(); placeMemoryDetail();
  memoryView.timer = setInterval(() => { if (panel.hidden) { clearInterval(memoryView.timer); memoryView.timer = null; return; } renderMemoryDetail(); placeMemoryDetail(); }, 1000);
}
{
  const meter = $('memory-meter'), panel = $('memory-detail');
  if (meter && panel) {
    let leaving = null;
    const enter = () => { clearTimeout(leaving); showMemoryDetail(true); }, leave = () => { clearTimeout(leaving); leaving = setTimeout(() => showMemoryDetail(false), 150); };
    meter.addEventListener('mouseenter', enter); meter.addEventListener('mouseleave', leave); panel.addEventListener('mouseenter', enter); panel.addEventListener('mouseleave', leave);   // the panel can be reached to select its text
    meter.addEventListener('focus', enter); meter.addEventListener('blur', leave);
    meter.addEventListener('keydown', event => { if (event.key === 'Escape') showMemoryDetail(false); });
    window.addEventListener?.('resize', placeMemoryDetail); window.addEventListener?.('scroll', placeMemoryDetail, true);
  }
}
// "Show layout bounds": page overlay over the device screen, redrawn only when a snapshot is drawn or the option changes.
function redrawLayoutBounds() {
  labHighlights.refresh();   // a plugin's highlights follow their components (nothing to do without highlights)
  labOverlays.refresh();     // and its overlays and tracks (src/lab-overlays.js; nothing to do without them)
  const canvas = $('layout-bounds-canvas'); if (!canvas) return;
  apkVM.syncLayoutBounds?.(!!deviceState.settings.layoutBounds);   // the Worker adds Compose's own rectangles to its snapshots only while the option is on
  const on = !!deviceState.settings.layoutBounds && !!state.lastSnapshot; canvas.hidden = !on; if (!on) return;
  const screen = $('android-screen'), frame = deviceState.bars?.contentFrame, width = screen.clientWidth || deviceState.bars?.widthDp || 411, height = screen.clientHeight || deviceState.bars?.heightDp || 914;
  drawLayoutBounds(canvas, layoutBoundsRects(state.lastSnapshot, { origin: { x: frame?.left ?? 0, y: frame?.top ?? 0 } }), width, height, { density: state.lastSnapshot.density ?? 1 });
}
const deviceState = { settings: loadDeviceSettings(), clockTimer: null };
// "Show frame rate": the FPS line and the frame-time bars over the device screen (src/frame-meter.js statistics, src/frame-graph.js drawing). A page-only developer option: the Worker measures
// each frame only while it is on, the page keeps one 250 ms sampling timer and redraws on an animation frame after a frame or a sample; off, none of that exists.
const frameMeter = new FrameMeter(); window.apkLabFrameMeter = frameMeter;   // read-only access for the checks that drive the page (scripts/validation)
let frameGraphTimer = null, frameGraphDraw = 0;
function drawFrameGraphNow() {
  frameGraphDraw = 0; const canvas = $('frame-graph-canvas'), screen = $('android-screen'); if (!canvas || !screen || !frameMeter.enabled) return;
  const width = screen.clientWidth || deviceState.bars?.widthDp || 411, height = screen.clientHeight || deviceState.bars?.heightDp || 914;
  drawFrameGraph(canvas, frameMeter, { width, height, top: (deviceState.settings.statusBarHeightDp ?? 24) + 4 });
}
frameMeter.onChange = () => { if (!frameGraphDraw) frameGraphDraw = (globalThis.requestAnimationFrame ?? (callback => setTimeout(callback, 16)))(drawFrameGraphNow); };
function syncFrameGraph() {
  const on = !!deviceState.settings.frameGraph, canvas = $('frame-graph-canvas'); apkVM.syncFrameTiming?.(on);
  if (on === frameMeter.enabled) return;
  frameMeter.setEnabled(on); if (canvas) canvas.hidden = !on;
  if (on) { frameGraphTimer = setInterval(() => frameMeter.sample(), SAMPLE_MS); frameMeter.onChange(); }
  else { clearInterval(frameGraphTimer); frameGraphTimer = null; if (frameGraphDraw) { (globalThis.cancelAnimationFrame ?? clearTimeout)(frameGraphDraw); frameGraphDraw = 0; } canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); }
}

const permissionsPanel = createPermissionsPanel({ $, vm: apkVM, location: { get: () => deviceState.settings.location, set: block => { deviceState.settings = { ...deviceState.settings, location: block }; saveDeviceSettings(deviceState.settings); } } });
const filesPanel = createSharedFilesPanel({ $, vm: apkVM });   // "Device files": the shared storage the file pickers and MediaStore read (src/shared-files-panel.js)
// "App data": the app's SharedPreferences and SQLite databases, viewed and edited in modals (src/app-data-panel.js, src/app-storage.js); read when the section is opened and after a run
const appDataPanel = createAppDataPanel({ $, vm: apkVM, modals: modalHost, ready: () => state.runtime === apkVM && state.launchAttempted && !state.busy, render: snapshot => renderSnapshot(snapshot) });
$('cp-sec-data')?.addEventListener('toggle', () => { if ($('cp-sec-data').open) appDataPanel.refresh(); });
const cameraLab = createCameraLab({ $, vm: apkVM });   // the device's cameras: source, frames for the VM, the camera screen of the capture Intents
const overridesPanel = createOverridesPanel({ $, vm: apkVM });
methodHooksPanel = createMethodHooksPanel({ $, vm: apkVM, trace: appendTrace, removePageRow: key => overridesPanel.removeKey(key), getPackage: () => state.inventory?.packageName ?? null, removeFile: path => codeTool.revertFile(path) });
// The Java debugger on the page (docs/DEBUGGER.md "The page, plugins and MCP"): one controller shared by the debugger UI of the Code tool, the plugins' lab.debug and MCP's debug_* tools.
apkVM.onDebugEvent = event => { codeTool.handleDebugEvent(event); pluginHost.debugEvent(event); };   // only an attached session sends events
const debugPausedView = {   // "Paused in the debugger": the preview bar's chip, the device's cover (it takes no input meanwhile) and the status bar
  last: null,
  paused(info) {
    const chip = $('debug-paused'), cover = $('debug-paused-overlay'), key = info ? `${info.where}|${info.thread}|${info.reason}` : null;
    if (key === this.last) return; const was = this.last; this.last = key;
    if (chip) { chip.hidden = !info; if (info) { chip.textContent = `Paused · ${info.where}`; chip.title = `Paused in the debugger (${info.reason}, thread ${info.thread}): the app's threads are suspended. Open the Code tool; F8 resumes.`; } }
    if (cover) { cover.hidden = !info; const where = cover.querySelector('.dpo-where'); if (where && info) where.textContent = `${info.where} · ${info.reason}`; }
    if (info) setStatus(`Paused in the debugger at ${info.where} (${info.reason}) · the app's threads are suspended; F8 or Resume goes on`);
    else if (was) setStatus(state.apkRunning ? 'Resumed: the app runs again' : 'Debugger: nothing paused');
    this.resume = info?.resume ?? null;
  },
};
$('debug-paused-overlay')?.querySelector('.dpo-resume')?.addEventListener('click', () => debugPausedView.resume?.());
$('debug-paused')?.addEventListener('click', () => { const tool = $('code-browser'); if (tool) { tool.open = true; tool.scrollIntoView?.({ block: 'nearest' }); } });
// The Code tool (docs/CODE-BROWSER.md) and the debugger: nothing of them is fetched or runs until the Code tab opens, a plugin / MCP / the console calls code.* or debug.*, or
// an APK with saved breakpoints opens (src/code-tool-loader.js). With the tab closed a session someone attached keeps working (pauses show here and flag or open the tab).
codeTool = createCodeTool({ root: $('code-browser'), vm: apkVM, hooks: methodHooksPanel, trace: appendTrace, getInventory: () => state.inventory ?? null, page: debugPausedView });
window.apkLabCodeBrowser = codeTool.browserApi;   // the Code browser's API (src/code-browser-api.js, docs/CODE-BROWSER.md): open, reveal, gutter clicks, markers, selection
window.apkLabDebugger = codeTool.debugger;   // test and console access: .state(), .breakpoints(), await .setBreakpoint({ className, line })
window.apkLabMethodHooks = methodHooksPanel;   // test and console access: .list(), .summary()
const microgEntriesPanel = createMicrogEntriesPanel({ $, vm: apkVM });
// "microG services" (src/microg-services-panel.js): each switch is a device setting, saved, recorded in the trace and, with a running microG, applied to it at once.
const microgServicesPanel = createMicrogServicesPanel({ $, onChange: services => {
  const before = deviceState.settings.microgServices ?? {};
  for (const service of MICROG_SERVICES) if ((before[service.id] === true) !== services[service.id]) appendTrace(`microG service ${service.label} turned ${services[service.id] ? `on: microG talks to ${service.who} (${service.hosts.join(', ')})` : 'off'} (Device > microG services)`);
  applyDeviceSettings({ ...readDevicePanel(), microgServices: services });
  if (apkVM.worker && state.loadedMicrog === true) apkVM.setMicrogServices(services).then(current => microgServicesPanel.update(current, true), () => {});
  showMicrogAccount();
} });
// "microG settings…" (src/microg-settings-dialog.js): the microG blocks above move into a tabbed dialog while it is open, and back.
const microgSettings = createMicrogSettingsDialog({ $, modalHost, overview: () => {
  const on = deviceState.settings?.microg === true, running = !!state.runtime && state.loadedMicrog !== undefined;
  if (!on) return 'With microG is off (Controls › Device › Google services): these settings are saved and apply once it is on and the APK is reopened.';
  return running && state.loadedMicrog !== true ? 'With microG is on, but the open APK runs without it: reopen the APK to apply.' : 'With microG is on.';
} });
window.apkLabMicrogSettings = microgSettings;   // test and console access: .open(tab), .close(), .isOpen
// Appearance > Orientation (src/orientation-lock.js): disabled, saying why, while the Activity on top fixes its orientation (snapshot.orientationLock).
const orientationLock = createOrientationLock({ $ });
const ignoredPanel = createIgnoredActivitiesPanel({ $, vm: apkVM });
pluginsPanel = createPluginsPanel({ $, host: pluginHost, modals: modalHost, toolbarRoot: $('plugin-toolbar'), onPower: level => apkVM.setPluginPower(level).catch(() => {}) });
// "Plugin power": the Worker's serving numbers (served, VM time, deferred, rejected, longest) next to the level, every 2 s while a plugin runs (src/plugin-power.js)
{ const powerStatus = setInterval(() => { if (document.hidden || !pluginHost.runningCount || !apkVM.worker) return; apkVM.pluginPowerStatus().then(status => { pluginHost.setWorkerStats(status); pluginsPanel.showPowerStats(status); }, () => {}); }, 2000); powerStatus?.unref?.(); }   // unref, as the last-run recorder: a test that loads this file must still exit. toolbarRoot: lab.button({ placement: 'toolbar' }) in the preview bar
// "MCP" (src/mcp-link.js, src/mcp-tools.js, scripts/lab-mcp.mjs): an MCP client on this machine uses this page through the local bridge; off until Connect
const MCP_KEY = 'apkweb-mcp-v1';
const mcpCaller = { id: 'mcp', name: 'MCP' };
/** Input for the MCP client through the page's own input paths (src/device-view.js): a tap on Compose content is a real touch (MotionEvents through the window), a View
 * is clicked like a mouse click on it, text goes in through the keyboard path (Compose: the field is focused, then select-all and one commitText per character on its
 * InputConnection, like Android's soft keyboard; SetText only when the field has no InputConnection) or the field's input (View), scrolling by the ScrollBy action (Compose) or the View's scroll. */
const mcpInput = {
  async target(args) {
    if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('No app is running: open an APK (it opens when loaded) or tap its icon on the home screen.'), { code: 'no-apk' });
    const elements = await pluginHost.query('layoutBounds', { names: false }), wanted = args.text ? String(args.text).toLowerCase() : null;
    const textOf = element => [...(element.texts ?? []), element.editableText ?? '', ...(element.contentDescriptions ?? [])].join(' ').toLowerCase();
    let element = null;
    if (args.element_key) element = elements.find(item => item.key === String(args.element_key)) ?? null;
    else if (args.test_tag || wanted) {
      const matches = elements.filter(item => (!args.test_tag || item.testTag === String(args.test_tag)) && (!wanted || textOf(item).includes(wanted)));
      element = matches.find(item => item.actions?.includes('OnClick')) ?? matches[0] ?? null;   // the clickable one first (a Button and its inner Text share the text)
    }
    if ((args.element_key || args.test_tag || wanted) && !element) throw Object.assign(new Error(`No component on screen with ${args.element_key ? `key ${args.element_key}` : [args.test_tag ? `testTag "${args.test_tag}"` : '', wanted ? `text "${args.text}"` : ''].filter(Boolean).join(' and ')} (see layout_bounds).`), { code: 'not-found' });
    const point = element?.bounds ? { x: (element.bounds.left + element.bounds.right) / 2, y: (element.bounds.top + element.bounds.bottom) / 2 } : Number.isFinite(args.x) && Number.isFinite(args.y) ? { x: args.x, y: args.y } : null;
    return { element, point, elements };
  },
  views() { return flattenViews(state.lastSnapshot).filter(view => view.visible && view.bounds); },
  ownerAt(point) { return this.views().filter(view => view.compose && point.x >= view.bounds.left && point.x < view.bounds.right && point.y >= view.bounds.top && point.y < view.bounds.bottom).at(-1) ?? null; },
  async tap(args) {
    const { element, point } = await this.target(args); if (!point) throw Object.assign(new Error('Say where to tap: test_tag, text, element_key or x and y.'), { code: 'bad-args' });
    const owner = element?.kind === 'view' ? null : this.ownerAt(point);
    if (owner) {   // a real touch: DOWN and UP at the point, in the Compose owner's coordinates (as the page's pointer handler sends them)
      const x = point.x - owner.bounds.left, y = point.y - owner.bounds.top, t = performance.now();
      state.pendingPointers.push({ ownerViewId: owner.id, action: 0, x, y, t }, { ownerViewId: owner.id, action: 1, x, y, t: t + 60 }); await flushPendingInputs();
      return { via: 'touch', element: element?.name ?? null, x: Math.round(point.x), y: Math.round(point.y) };
    }
    const view = element?.kind === 'view' ? { id: element.id } : this.views().filter(item => item.clickable && point.x >= item.bounds.left && point.x < item.bounds.right && point.y >= item.bounds.top && point.y < item.bounds.bottom).sort((a, b) => b.depth - a.depth)[0];
    if (!view) throw Object.assign(new Error('Nothing clickable at that point.'), { code: 'not-found' });
    await clickView(view.id); return { via: 'click on the View', element: element?.name ?? null, id: view.id };
  },
  async type(args) {
    const { element } = await this.target(args); if (!element) throw Object.assign(new Error('Say which field to type in: test_tag, text or element_key.'), { code: 'bad-args' });
    const text = String(args.value ?? '');
    if (element.kind === 'compose') {
      if (!element.actions?.includes('SetText')) throw Object.assign(new Error(`${element.name} is not a text field (no SetText action).`), { code: 'bad-args' });
      const [, owner, node] = String(element.key).split(':'), ownerId = Number(owner), nodeId = Number(node), fallbacks = state.imeFallbacks ?? 0;
      if (element.actions.includes('RequestFocus')) deviceView.queueComposeAction(ownerId, nodeId, 'RequestFocus');   // the field gains focus first: that starts its input session
      // replace the whole text as a person would: select all, then type character by character (each key carries the SetText fallback the field would get without a connection)
      const characters = [...text], ops = [{ kind: 'selectAll', fallbackText: null }, ...(characters.length ? characters.map((character, index) => ({ kind: 'commit', text: character, fallbackText: characters.slice(0, index + 1).join('') })) : [{ kind: 'deleteBackward', fallbackText: '' }])];
      deviceView.queueComposeAction(ownerId, nodeId, 'ime', ops); await flushPendingInputs();
      return { element: element.name, value: text, via: (state.imeFallbacks ?? 0) > fallbacks ? 'SetText (the field has no InputConnection; see the execution log)' : 'keyboard (InputConnection)' };
    } else { state.pendingInputs.set(element.id, text); await flushPendingInputs(); }
    return { element: element.name, value: text };
  },
  async scroll(args) {
    const { element, point, elements } = await this.target(args), dx = Number(args.dx ?? 0), dy = Number(args.dy ?? 400);
    const inside = (outer, p) => outer.bounds && p && p.x >= outer.bounds.left && p.x <= outer.bounds.right && p.y >= outer.bounds.top && p.y <= outer.bounds.bottom;
    const area = item => item.bounds ? (item.bounds.right - item.bounds.left) * (item.bounds.bottom - item.bounds.top) : Infinity;
    // the scrollable that holds the point (the smallest), or the largest one on screen when no target was given
    const scrollables = elements.filter(item => item.kind === 'compose' && item.actions?.includes('ScrollBy'));
    const composeTarget = (element?.actions?.includes('ScrollBy') ? element : null) ?? (point ? scrollables.filter(item => inside(item, point)).sort((a, b) => area(a) - area(b))[0] : scrollables.sort((a, b) => area(b) - area(a))[0]);
    if (composeTarget) { const [, owner, node] = String(composeTarget.key).split(':'); deviceView.queueComposeAction(Number(owner), Number(node), 'ScrollBy', [dx, dy]); await flushPendingInputs(); return { via: 'ScrollBy', element: composeTarget.name, dx, dy }; }
    const views = this.views().filter(view => /ScrollView|RecyclerView|ListView|NestedScrollView/.test(String(view.type)) && (!point || inside(view, point))).sort((a, b) => b.depth - a.depth);
    if (!views.length) throw Object.assign(new Error('Nothing scrollable on screen.'), { code: 'not-found' });
    const previous = state.pendingScrollBys.get(views[0].id) ?? { dx: 0, dy: 0 }; state.pendingScrollBys.set(views[0].id, { dx: previous.dx + dx, dy: previous.dy + dy }); await flushPendingInputs();
    return { via: 'View scroll', id: views[0].id, dx, dy };
  },
  async back() { if (!state.canGoBack) throw Object.assign(new Error('There is no previous screen to go back to.'), { code: 'bad-args' }); await backAPK(); return { back: true }; },
  scrollTo: args => labScrollCall('scrollTo', args), scrollInfo: args => labScrollCall('info', args),   // to a position / percentage (src/lab-scroll.js), as lab.scrollTo of the plugins
};
// The Controls panel and the device's apps for MCP (src/mcp-tools.js: app_data, device, host_redirects; and the adb device facade below: install, open, close): each does
// what the page's own control does.
const DEVICE_KEYS_MCP = ['screen', 'orientation', 'locale', 'darkTheme', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'battery', 'connectivity', 'navigation', 'renderer', 'engine', 'eventSeconds', 'memoryMiB', 'raster'];
/** The apps of the device's home screen as the MCP tools name them (ids an agent can carry: printableShelfId), and the app of this VM. */
const mcpAppList = async () => (apkShelf ? await apkShelf.list() : []).map(({ icon, id, ...item }) => ({ id: printableShelfId(id), ...item, current: id === state.shelfId, open: id === state.shelfId && state.apkRunning }));
const mcpAppState = () => ({ id: state.shelfId ? printableShelfId(state.shelfId) : null, packageName: state.inventory?.packageName ?? null, file: state.currentSource?.name ?? null, running: state.apkRunning,
  ...(state.inventory?.unsupportedFeatures?.length ? { cannotRun: [...state.inventory.unsupportedFeatures] } : {}), error: state.lastAPKError ? String(state.lastAPKError.error?.message ?? state.lastAPKError.error) : null });
const mcpNamedApp = async ({ id = null, packageName = null, name = null } = {}) => id || packageName || name ? resolveShelfApp(apkShelf ? await apkShelf.list() : [], { id, packageName, name }) : null;
const waitIdle = async (ms = 60000) => { for (const until = Date.now() + ms; (state.busy || state.runStarting || apkVM.pending) && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 50)); };
const mcpControls = {
  async appData(payload) {
    if (state.runtime !== apkVM || !state.launchAttempted) throw new Error('No app is running: open and start an app first.');
    await waitIdle(); const { appData, snapshot } = await apkVM.appStorage(payload); if (snapshot) renderSnapshot(snapshot); if ($('cp-sec-data')?.open && payload.op !== 'overview') appDataPanel.refresh(); return appData;
  },
  device(set = null) {
    const pick = settings => Object.fromEntries(DEVICE_KEYS_MCP.filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
    if (set && typeof set === 'object' && (set.language || set.region)) { const [language, region] = String(set.locale ?? deviceState.settings.locale).split('-'); set = { ...set, locale: `${set.language ?? language}-${String(set.region ?? region).toUpperCase()}` }; delete set.language; delete set.region; }
    if (set && typeof set === 'object') { const unknown = Object.keys(set).filter(key => !DEVICE_KEYS_MCP.includes(key)); if (unknown.length) throw new Error(`Unknown settings: ${unknown.join(', ')} (available: ${DEVICE_KEYS_MCP.join(', ')})`); applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, ...set })); }
    return { settings: pick(deviceState.settings), screens: DEVICE_SCREENS.map(([id]) => id), languages: DEVICE_LANGUAGE_CODES, regions: 'any ISO 3166 alpha-2 country (set.region), with set.language: locale = language-REGION', connectivity: ['online', 'metered', 'offline'], appRunning: state.apkRunning };
  },
  async apps(action = 'list', id = null) {
    if (action === 'list') return { apps: await mcpAppList(), running: state.apkRunning, file: state.currentSource?.name ?? null };
    if (action === 'open') { if (!id) throw new Error('id is required (from apps list)'); return mcpControls.openApp({ id: String(id) }); }
    await waitIdle();
    if (action === 'restart') { if (!state.currentSource) throw new Error('No APK open'); state.needsRestart = true; await runAPK(); }
    else if (action === 'stop') cancelOperation();
    else throw new Error('action is list, open, restart or stop');
    await waitIdle(); return mcpAppState();
  },
  /** adb install: the file the bridge handed over is installed as a file dropped on the page is (read in the Worker, kept on the home screen); `open` also starts it. */
  async installApk(file, { open = false } = {}) {
    if (!file || !/\.(apk|aab|apks|xapk|apkm)$/i.test(file.name)) throw new Error('The file must be an .apk, .aab or a split-APK set (.apks / .xapk / .apkm).');
    file = await bundleAsApk(file);
    if (file.size > 1024 * 1024 * 1024) throw new Error('This lab limits APKs to 1 GiB.');
    const source = { file, name: file.name };
    await importSource(source, open); await waitIdle();
    if (state.currentSource !== source) throw new Error(`The installation of ${file.name} was interrupted: another APK was opened in the page.`);
    if (!state.inventory) throw new Error(`Could not install ${file.name}: ${state.lastAPKError ? String(state.lastAPKError.error?.message ?? state.lastAPKError.error) : 'reading the APK was canceled'}`);
    appendTrace(`adb install: ${file.name} installed${open ? ' and opened' : ''}`);
    return { installed: true, ...mcpAppState(), launcherActivity: state.inventory.launcherActivity ?? null, sizeBytes: file.size, ...(open ? { opened: state.apkRunning } : { note: 'Installed on the home screen; adb shell monkey -p <package> 1 opens it.' }) };
  },
  /** adb's open (am start, monkey): what a tap on the app's launcher icon does. The app of this VM is started (or brought back from the background); another installed one is loaded and started. */
  async openApp(selector = {}) {
    const entry = await mcpNamedApp(selector);
    if (!entry && !state.currentSource) throw new Error('No current app: say which one to open (id, package or name; apps lists the installed ones) or install one with adb install.');
    await waitIdle();
    const current = entry ? entry.id === state.shelfId && !!state.currentSource : true;
    if (current && state.runtime && state.apkRunning) {
      const mode = taskSwitcher?.state?.(); if (mode === 'home' || mode === 'overview') { await taskSwitcher.resume?.(); await waitIdle(); }
      return { opened: true, alreadyOpen: true, ...mcpAppState() };
    }
    if (current && (state.runtime || state.needsRestart)) await runAPK();
    else if (entry) await openSavedApp(entry.id);
    else { state.needsRestart = true; await runAPK(); }   // the VM of the current APK was ended (apps stop): reopened in a fresh Worker
    await waitIdle(); if (state.apkRunning) appendTrace('adb (open): app opened');
    return { opened: state.apkRunning, ...mcpAppState() };
  },
  /** adb's close (am force-stop): the app is thrown away as from the recents (dismissApp). One app runs at a time: a named app that is not the open one is reported, not closed. */
  async closeApp(selector = {}) {
    const entry = await mcpNamedApp(selector);
    if (entry && entry.id !== state.shelfId) return { closed: false, ...mcpAppState(), note: `${printableShelfId(entry.id)} is not the open app.` };
    if (state.busy || state.runStarting) await waitIdle(5000);
    if (state.busy || state.runStarting) { cancelOperation(); appendTrace('adb (close): the app was still opening; the VM was ended'); return { closed: true, ...mcpAppState(), note: 'The app was still opening: the VM was ended.' }; }
    if (!state.runtime || !state.apkRunning) return { closed: false, ...mcpAppState(), note: state.currentSource ? 'The current app is not open.' : 'No app is open.' };
    dismissApp('by adb (close)');
    return { closed: !state.apkRunning, ...mcpAppState() };
  },
  async openLink({ link = '', action = '', component = '' } = {}) {
    const request = buildDeepLinkRequest({ link, action: action || undefined, component }), packageName = request.component?.includes('/') ? request.component.split('/')[0] : null;
    if (packageName) { const note = await adbDevice.ensureLoaded(packageName); if (note) appendTrace(note); }
    const outcome = await adbDevice.startIntent(request, { packageName }); await waitIdle(); const result = describeDeepLink(outcome);
    return { state: result.state, message: result.message, ...(result.detail ? { detail: result.detail } : {}), packageName: outcome.packageName ?? null, ...(outcome.notes?.length ? { notes: outcome.notes } : {}) };
  },
  hostRedirects(rules = null) {
    if (Array.isArray(rules)) applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, network: { ...deviceState.settings.network, hostMap: rules } }));
    return { rules: deviceState.settings.network?.hostMap ?? [], allowedHosts: deviceState.settings.network?.allowedHosts ?? [] };
  },
  permissions(name = null, value = null) { if (!permissionsPanel) throw new Error('Permissions are not available'); return { permissions: name ? permissionsPanel.set(name, value) : permissionsPanel.list() }; },
};
/** The device as the adb interpreter drives it (src/adb-commands.js, the `adb` MCP tool): each method is the page's own path for that action, the same ones the panels, the launcher and
 * the other MCP tools use. Failures are Errors with what is missing; nothing answers for a path the page does not have. */
const adbFail = message => Object.assign(new Error(message), { code: 'adb' });
const adbFocusedFieldNow = () => {   // the text field keys go to: the focused editable Compose node (of the owner the VM's InputMethodManager serves, when there is one), else the focused View text field
  const editable = item => item.focused === true && (item.editableText != null || (item.actions ?? []).some(action => (action.name ?? action) === 'SetText'));
  const owners = (state.lastSnapshot?.composeSemantics?.owners ?? []).filter(item => item.attached !== false), served = state.imeState?.connected ? state.imeState.servedViewId : null;
  const owner = owners.find(item => item.ownerViewId === served && (item.nodes ?? []).some(editable)) ?? owners.find(item => (item.nodes ?? []).some(editable)), node = owner?.nodes?.find(editable) ?? null;
  if (node) return { compose: true, ownerViewId: owner.ownerViewId, nodeId: node.nodeId, text: node.editableText ?? '', served: owner.ownerViewId === served };
  let found = null; (function walk(view) { if (!view || found) return; if (view.focused && typeof view.text === 'string' && view.inputType !== undefined && !view.readOnly && state.viewElements.get(String(view.id))?.dataset?.kind === 'input') found = view; for (const child of view.children ?? []) walk(child); })({ children: state.lastSnapshot?.views ?? [] });
  return found ? { compose: false, id: found.id, text: found.text ?? '' } : null;
};
/** The focused field, waiting a little for it: the focus of a tap reaches the page with the frame that follows it, and a Compose field's input session (its InputConnection) a
 *  frame later still. A field that has none after the wait is returned as it is: its keys then take the SetText fallback, which the result says. */
const adbFocusedField = async () => { for (const until = Date.now() + 2000; ;) { await flushPendingInputs(); const field = adbFocusedFieldNow(); if ((field && (!field.compose || field.served)) || Date.now() >= until) return field; await new Promise(resolve => setTimeout(resolve, 100)); } };
// What a key of `input keyevent` is to a focused text field: the character an unmodified key of a standard keyboard types (android.view.KeyEvent key codes: digits 7-16, letters 29-54,
// punctuation), committed as a keyboard commits it, or a cursor key (D-pad, Page Up/Down, Home/End), sent as a KeyEvent through the field's InputConnection as the page's own
// keyboard sends it. Other keys would have to be dispatched to the window, which the page cannot do.
const ADB_CURSOR_KEYS = new Set([19, 20, 21, 22, 92, 93, 122, 123]);
const ADB_KEY_CHARACTERS = new Map([...'0123456789'].map((ch, i) => [7 + i, ch]).concat([...'abcdefghijklmnopqrstuvwxyz'].map((ch, i) => [29 + i, ch]), [[17, '*'], [18, '#'], [55, ','], [56, '.'], [62, ' '], [68, '`'], [69, '-'], [70, '='], [71, '['], [72, ']'], [73, '\\'], [74, ';'], [75, "'"], [76, '/'], [77, '@'], [81, '+']]));
const adbDevice = {
  async info() {
    const d = resolveDevice(deviceState.settings), inventory = state.inventory, screen = state.apkRunning ? await pluginHost.query('screen', {}).catch(() => null) : null, mode = taskSwitcher?.state?.();
    return { packageName: inventory?.packageName ?? null, loaded: !!state.currentSource && !!inventory, running: !!state.runtime && state.apkRunning, starting: state.busy || state.runStarting, background: mode === 'home' || mode === 'overview',
      activity: screen?.activity ?? null, tasks: screen?.tasks ?? [], dialogs: screen?.dialogs ?? 0, widthPx: d.widthDp, heightPx: d.heightDp, densityDpi: 160, pid: logcatPanel.store.entries.at(-1)?.pid ?? null,
      inventory: inventory ? { packageName: inventory.packageName, versionName: inventory.manifestAttrs?.versionName ?? null, versionCode: inventory.manifestAttrs?.versionCode ?? null, minSdk: inventory.usesSdk?.minSdkVersion ?? null, targetSdk: inventory.usesSdk?.targetSdkVersion ?? null, requestedPermissions: (inventory.usesPermissions ?? []).map(item => item.name) } : null };
  },
  async packages() {
    const out = (apkShelf ? await apkShelf.list() : []).filter(item => item.packageName).map(item => ({ packageName: item.packageName, system: false }));
    if (state.inventory?.packageName && !out.some(item => item.packageName === state.inventory.packageName)) out.push({ packageName: state.inventory.packageName, system: false });   // a hosted example is not on the home screen
    for (const companion of state.inventory?.companionPackages ?? []) out.push({ packageName: companion.packageName, system: true });   // the packages of a device option (microG)
    return out;
  },
  async install(file, { grant = false } = {}) {
    await mcpControls.installApk(file, { open: false });
    if (grant) for (const permission of permissionsPanel?.list() ?? []) if (permission.applicable && permission.state !== 'allow') permissionsPanel.set(permission.name, 'allow');
  },
  /** Loads the package's APK into the VM (not started) when it is not the one there: one app at a time. -> a note, or null when it was already loaded. */
  async ensureLoaded(packageName) {
    await waitIdle();
    if (state.inventory?.packageName === packageName && state.currentSource) { if (!state.runtime) { await importSource(state.currentSource); await waitIdle(); if (!state.inventory) throw adbFail(`Could not load ${packageName}: ${state.lastAPKError ? String(state.lastAPKError.error?.message ?? state.lastAPKError.error) : 'reading the APK was canceled'}`); } return null; }
    const entry = (apkShelf ? await apkShelf.list() : []).filter(item => item.packageName === packageName).sort((a, b) => b.openedAt - a.openedAt)[0]; if (!entry) throw adbFail(`The package ${packageName} is not installed.`);
    const replaced = state.apkRunning ? state.inventory?.packageName : null, got = await apkShelf.file(entry.id); if (!got) throw adbFail(`The APK of ${packageName} is no longer stored in this browser.`);
    await importSource({ file: got.file, name: got.file.name, shelfId: entry.id }, false); await waitIdle();
    if (state.inventory?.packageName !== packageName) throw adbFail(`Could not load ${packageName}: ${state.lastAPKError ? String(state.lastAPKError.error?.message ?? state.lastAPKError.error) : 'reading the APK was canceled'}`);
    return `${packageName} was loaded on the device${replaced ? `; ${replaced}, which was open, was ended (one app at a time)` : ''}.`;
  },
  async uninstall(packageName, { keepData = false } = {}) {
    const entries = (apkShelf ? await apkShelf.list() : []).filter(item => item.packageName === packageName), isCurrent = state.inventory?.packageName === packageName;
    if (!entries.length && !isCurrent) return false;
    if (!keepData) { await this.ensureLoaded(packageName); await waitIdle(); showAppData(await apkVM.clearAppData()); }   // the data goes with the package, as on a device
    await waitIdle();
    if (state.inventory?.packageName === packageName) { cancelOperation(); markLastRunEnded(); state.currentSource = null; state.inventory = null; state.shelfId = null; state.needsRestart = false; $('preview-name').textContent = 'App preview'; appInfo.render(); setStatus(`${packageName} uninstalled`); }
    for (const entry of entries) await apkShelf.remove(entry.id);
    await refreshShelf(); appendTrace(`adb: ${packageName} uninstalled${keepData ? ' (data kept)' : ' (data deleted)'}`); return true;
  },
  async clearData() {   // Settings > Apps > Clear storage: the data is wiped and the app's process ends (the APK stays loaded, not started)
    await waitIdle(); if (!state.runtime) { await importSource(state.currentSource); await waitIdle(); } if (!state.runtime) throw adbFail('No app is loaded.');
    showAppData(await apkVM.clearAppData()); appendTrace('adb: app data deleted (pm clear)'); if (state.currentSource) await importSource(state.currentSource); await waitIdle();
  },
  async openApp() { const result = await mcpControls.openApp({}); return { opened: !!result.opened, error: result.error ?? (result.cannotRun ? result.cannotRun.join('; ') : null) }; },
  async closeApp() { return mcpControls.closeApp({}); },
  /** Which installed app answers an implicit Intent: the app in the VM first, then the others by their kept filters (most recently opened first), as resolveActivity would
   *  over the installed packages. -> { packageName | null (none answers), others: [packages that also answer], unknown: [packages installed before their filters were kept] } */
  async intentHandler(intent) {
    const fields = { action: intent.action ?? null, data: intent.data ?? null, type: intent.type ?? null, categories: intent.category ?? [] }, answers = manifest => resolveIntentFields(manifest, fields).matches.length > 0;
    const current = state.inventory?.packageName && state.currentSource ? state.inventory.packageName : null, handlers = [], unknown = [];
    if (current && answers(state.inventory)) handlers.push(current);
    const entries = (apkShelf ? await apkShelf.manifests() : []).sort((a, b) => b.openedAt - a.openedAt), known = new Set(entries.filter(entry => entry.activities).map(entry => entry.packageName));
    for (const entry of entries) {
      if (!entry.packageName || entry.packageName === current || handlers.includes(entry.packageName)) continue;
      if (!entry.activities) { if (!known.has(entry.packageName) && !unknown.includes(entry.packageName)) unknown.push(entry.packageName); continue; }   // another file of the same package may carry the filters
      if (answers({ packageName: entry.packageName, activities: entry.activities })) handlers.push(entry.packageName);
    }
    return { packageName: handlers[0] ?? null, others: handlers.slice(1), unknown };
  },
  /** Starts an Activity from an Intent, as `am start`: an explicit component or package names its app; an implicit Intent goes to the installed app whose filters answer it. That
   *  app is loaded when it is not the one in the VM (one app at a time) and the Intent starts it; an app already running receives it as a new start from the system. */
  async startIntent(intent, { packageName = null } = {}) {
    await waitIdle(); const notes = [];
    if (!packageName && !intent.component) {
      const handler = await this.intentHandler(intent);
      if (handler.packageName && handler.packageName !== state.inventory?.packageName) { const note = await this.ensureLoaded(handler.packageName); if (note) notes.push(note); }
      if (handler.others.length) notes.push(`Other installed apps also answer this Intent: ${handler.others.join(', ')} (on a device the system would show the choice).`);
      if (!handler.packageName && handler.unknown.length) notes.push(`Apps installed before the lab kept the manifest filters were not searched: ${handler.unknown.join(', ')}. Open each one once to register them.`);
    }
    if (!state.runtime && state.currentSource) { await importSource(state.currentSource); await waitIdle(); }
    if (!state.runtime) throw adbFail(`No installed app answers this Intent.${notes.length ? ' ' + notes.join(' ') : ' Install the app (adb install) or name the component (-n package/.Activity).'}`);
    await flushPendingInputs(); switchMode('apk'); hideError(); state.lastAPKError = null; state.stickyError = false;
    const token = beginOperation('Opening Intent…'); state.runStartedAt = Date.now();
    try { const { deepLink, snapshot } = await state.runtime.startIntent(intent, { onProgress: onWorkerProgress }); if (token === state.operation) { if (deepLink?.ok && deepLink.launched) state.launchAttempted = true; if (snapshot) renderSnapshot(snapshot); } return { ...deepLink, packageName: state.inventory?.packageName ?? null, notes }; }
    catch (error) { if (token === state.operation && error?.name !== 'TypeError') reportAPKError(error, 'Could not open the Intent', { crash: true }); throw error; }
    finally { finishOperation(token); }
  },
  async waitReady(ms = 15000) { const result = await waitScreenReady({ screen: () => pluginHost.query('screen', {}).catch(() => null), requests: () => netlogPanel.store.entries }, ms); return { ready: result.ready, activity: result.screen?.activity ?? null }; },
  async permissions() { return permissionsPanel?.list() ?? []; },
  async setPermission(name, value) { if (!permissionsPanel) throw adbFail('Permissions are not available'); permissionsPanel.set(name, value); },
  async tap(x, y) { const result = await mcpInput.tap({ x, y }); return result.via; },
  async swipe(x1, y1, x2, y2, ms) {
    if (!state.runtime || !state.apkRunning) throw adbFail('No app is open.');
    await flushPendingInputs(); const from = { x: x1, y: y1 }, owner = mcpInput.ownerAt(from), still = Math.hypot(x2 - x1, y2 - y1) < 1;
    if (owner && still) {   // `input swipe x y x y 1000` is how adb long-presses: the OnLongClick action of the component at the point
      const inside = item => item.bounds && x1 >= item.bounds.left && x1 < item.bounds.right && y1 >= item.bounds.top && y1 < item.bounds.bottom, area = item => (item.bounds.right - item.bounds.left) * (item.bounds.bottom - item.bounds.top);
      const target = (await pluginHost.query('layoutBounds', { names: false })).filter(item => item.kind === 'compose' && item.actions?.includes('OnLongClick') && inside(item)).sort((a, b) => area(a) - area(b))[0];
      if (!target) throw adbFail('Long press: no component at that point has the OnLongClick action.');
      const [, ownerId, node] = String(target.key).split(':'); deviceView.queueComposeAction(Number(ownerId), Number(node), 'OnLongClick'); await flushPendingInputs(); return `long press on ${target.name} (the component's OnLongClick action)`;
    }
    if (owner) {   // a real drag through the window: DOWN, MOVEs and UP with the gesture's own clock, one sample per request so none is merged
      const steps = Math.max(2, Math.min(40, Math.round(ms / 16))), t0 = performance.now(), at = k => ({ x: x1 + (x2 - x1) * k - owner.bounds.left, y: y1 + (y2 - y1) * k - owner.bounds.top, t: t0 + ms * k });
      for (let i = 0; i <= steps + 1; i++) { const k = Math.min(1, i / steps), sample = at(k); state.pendingPointers.push({ ownerViewId: owner.id, action: i === 0 ? 0 : i === steps + 1 ? 1 : 2, x: sample.x, y: sample.y, t: i === steps + 1 ? sample.t + 1 : sample.t }); await flushPendingInputs(); }
      return `real drag (MotionEvents) from ${Math.round(x1)},${Math.round(y1)} to ${Math.round(x2)},${Math.round(y2)} in ${ms} ms`;
    }
    const view = mcpInput.views().filter(item => /ScrollView|RecyclerView|ListView|NestedScrollView|ViewPager/.test(String(item.type)) && x1 >= item.bounds.left && x1 < item.bounds.right && y1 >= item.bounds.top && y1 < item.bounds.bottom).sort((a, b) => b.depth - a.depth)[0];
    if (!view) throw adbFail('Nothing at that point takes the gesture: outside a Compose screen the page scrolls scrollable Views (View.scrollBy), and there is none there.');
    const previous = state.pendingScrollBys.get(view.id) ?? { dx: 0, dy: 0 }; state.pendingScrollBys.set(view.id, { dx: previous.dx + (x1 - x2), dy: previous.dy + (y1 - y2) }); await flushPendingInputs();
    return `scroll of View ${view.id} by View.scrollBy (outside Compose the page does not send MotionEvents)`;
  },
  async text(text) {
    const field = await adbFocusedField(); if (!field) throw adbFail('No text field has focus: tap the field first (input tap).');
    if (!field.compose) { state.pendingInputs.set(field.id, field.text + text); await flushPendingInputs(); return 'appended to the end of the field (View)'; }
    const characters = [...text], fallbacks = state.imeFallbacks ?? 0;
    deviceView.queueComposeAction(field.ownerViewId, field.nodeId, 'ime', characters.map((character, index) => ({ kind: 'commit', text: character, fallbackText: field.text + characters.slice(0, index + 1).join('') }))); await flushPendingInputs();
    return (state.imeFallbacks ?? 0) > fallbacks ? 'SetText (the field has no InputConnection)' : 'keyboard (InputConnection), character by character';
  },
  async key(code) {
    const enter = code === 66 || code === 160, character = ADB_KEY_CHARACTERS.get(code);
    const cursor = ADB_CURSOR_KEYS.has(code);
    if (!enter && code !== 67 && code !== 112 && character === undefined && !cursor) throw adbFail(`Key ${code}: the page has no KeyEvent dispatch to the window. BACK (4), HOME (3), APP_SWITCH (187) have a path and, in a focused text field, letters, digits, punctuation, space, ENTER, DEL, FORWARD_DEL and the cursor keys.`);
    const field = await adbFocusedField();
    if (!field) throw adbFail(`Key ${code}: no text field has focus (tap the field first). The page has no KeyEvent dispatch to the window; outside a field only BACK (4), HOME (3) and APP_SWITCH (187) have a path.`);
    if (!field.compose) {
      if (code === 67) { state.pendingInputs.set(field.id, [...field.text].slice(0, -1).join('')); await flushPendingInputs(); return 'last character deleted (View)'; }
      if (character !== undefined) { state.pendingInputs.set(field.id, field.text + character); await flushPendingInputs(); return `"${character}" appended to the end of the field (View)`; }
      throw adbFail(`Key ${code}: in a View field the page types characters and deletes the last one (DEL, 67); the cursor keys only have a path in a Compose field.`);
    }
    const op = enter ? { kind: 'enter' } : code === 67 ? { kind: 'deleteBackward', fallbackText: [...field.text].slice(0, -1).join('') } : code === 112 ? { kind: 'deleteForward' } : cursor ? { kind: 'key', code, meta: 0, fallbackText: null } : { kind: 'commit', text: character, fallbackText: field.text + character };
    deviceView.queueComposeAction(field.ownerViewId, field.nodeId, 'ime', [op]); await flushPendingInputs();
    return op.kind === 'key' ? 'cursor key through the focused field\'s InputConnection (sendKeyEvent)' : op.kind === 'enter' ? 'keyboard action (Enter) on the focused field' : op.kind === 'commit' ? `"${character}" by the keyboard (commitText) in the focused field` : 'delete in the focused field';
  },
  async keyCode(name) { const table = (await import('./framework-constants-data.js?v=28012a33f717')).default.classes['android/view/KeyEvent'] ?? []; for (const group of table) for (const [constant, type, value] of group) if (constant === name && type === 'I') return value; return null; },
  async nav(button) {
    await waitIdle(); const done = await taskSwitcher?.navigate?.(button);
    if (!done) throw adbFail(button === 'back' ? 'BACK: there is no app in front.' : button === 'home' ? 'HOME: the device is already on the home screen.' : 'APP_SWITCH: there is no open app.');
    await waitIdle(); return { back: 'went back one screen (onBackPressed)', home: 'app in the background, home screen', overview: 'recents', foreground: 'back to the app' }[done];
  },
  async screenshot() { return pluginHost.query('screenshot', {}); },
  async snapshot() { await flushPendingInputs(); return state.lastSnapshot; },
  async resourceNames(ids) { const names = new Map(); for (let i = 0; i < ids.length; i += 256) { const reply = await pluginHost.query('resourceIds', { ids: ids.slice(i, i + 256) }).catch(() => null); for (const [id, name] of Object.entries(reply?.names ?? {})) if (name) names.set(Number(id), name); } return names; },
  async logcat() { return logcatPanel.store.entries; },
  async clearLogcat() { logcatPanel.reset(); },
  async settings() { return deviceState.settings; },
  async setSettings(patch) { applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, ...patch })); await waitIdle(); },
  async buildProps() { return Object.fromEntries(identityProperties(identitySource())); },   // the device identity (src/device-identity.js): the lab's, or the custom one the user typed, of the running app (else of the panel); its ABI part is that of the running app's ABI option
  async sharedFiles() { await filesPanel.ready?.catch?.(() => {}); return filesPanel.state.files.map(file => ({ id: file.id, name: file.name, mime: file.mime, size: file.size, modified: file.modified })); },
  async pushShared(file) { const before = new Set(filesPanel.state.files.map(item => item.id)); await filesPanel.addFiles([file]); const added = filesPanel.state.files.find(item => !before.has(item.id)); if (!added) throw adbFail(filesPanel.state.note || 'The file was not accepted by the device storage.'); return { name: added.name }; },
  async removeShared(id) { await filesPanel.removeFile(id); },
  async sharedBlob(id) { const file = filesPanel.state.files.find(item => item.id === id); if (!file) throw adbFail('The file is no longer on the device.'); return file.blob; },
};
// record_screen (MCP): the video is painted from the rasters on screen (src/screen-recorder.js); starting and stopping show in the execution log and the status line
const screenRecorder = createScreenRecorder({ paint: (canvas, options) => paintScreen(state.lastSnapshot, id => state.viewElements.get(String(id)) ?? null, canvas, options) });
mcpControls.recordScreen = {
  start(options) { if (!state.runtime || !state.apkRunning) throw new Error('No app is open: open an app before recording the screen.'); const started = screenRecorder.start(options); appendTrace(`MCP (record_screen): recording the screen, ${started.width}×${started.height} at ${started.fps} frames/s, up to ${started.maxSeconds} s (${started.container})`); return started; },
  async stop() { const video = await screenRecorder.stop(); appendTrace(`MCP (record_screen): recording ended, ${video.seconds} s, ${video.frames} frames, ${formatSize(video.bytes)}`); return video; },
  status: () => screenRecorder.status(), discard: () => screenRecorder.discard(),
};
// Photo and Record in the device bar (src/device-media.js): the same capture and recorder as MCP's screenshot and record_screen, saved as downloads
createDeviceMedia({ photoButton: $('device-photo'), recordButton: $('device-record'), recorder: screenRecorder, isRunning: () => !!(state.runtime && state.apkRunning && state.lastSnapshot),
  capture: () => captureImage({ snapshot: state.lastSnapshot, getHost: id => state.viewElements.get(String(id)) ?? null, maxWidth: 2048 }),
  getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app', status: (message, kind) => setStatus(message, kind), trace: line => appendTrace(line),
  save: (name, blob) => { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); } });
const adbInterpreter = createAdb(adbDevice);
mcpControls.adb = (input, io) => runAdb('MCP', input, io);
// The adb terminal of the tool dock and lab.adb of the plugins run the same interpreter; every command is written to the execution log with who ran it
const runAdb = (who, input, io) => { appendTrace(`adb (${who}): ${typeof input.command === 'string' ? input.command : (input.args ?? []).join(' ')}`.slice(0, 400)); return adbInterpreter.run(input, io); };
if ($('adb-terminal')?.querySelector?.('.adb-output')) window.apkLabTerminal = createAdbTerminal({ root: $('adb-terminal'), run: (command, io) => runAdb('terminal', { command }, io) });
window.apkLabAdb = adbInterpreter;   // test and console access: await apkLabAdb.run({ command: 'adb shell wm size' })
const mcpTools = createMcpTools({ debug: { controller: () => codeTool.debugger, actions: debugActions, owner: mcpCaller }, hook: spec => methodHooksPanel.add(mcpCaller, spec), controls: mcpControls, input: mcpInput, actions: { mock: spec => pluginActions.mock(mcpCaller, spec), unmock: id => pluginActions.unmock(mcpCaller, { id }), mocks: () => pluginActions.mocks(mcpCaller), reload: mode => pluginActions.reload(mcpCaller, { mode }) }, query: (method, args) => pluginHost.query(method, args), plugins: () => pluginHost.list?.() ?? [], pluginStore: { list: () => pluginsPanel?.list?.() ?? [], save: spec => { const saved = pluginsPanel.save(spec); appendTrace(`MCP (save_plugin): plugin "${saved.plugin.name}" ${saved.created ? 'created' : 'changed'}${saved.plugin.enabled ? '' : ' (off)'}`); return saved; } }, clickButton: (id, button) => pluginHost.clickButton(id, button, { by: 'mcp' }), logcat: () => logcatPanel.store.entries, network: () => netlogPanel.store.entries, frameStats: () => frameMeter.enabled ? frameMeter.summary() : null,
  status: () => ({ running: !!apkVM.worker, packageName: state.inventory?.packageName ?? null, file: state.fileName ?? null, appModified: methodHooksPanel?.summary() ?? { count: 0 } }) });
window.apkLabMcpTools = mcpTools;   // test and console access: await apkLabMcpTools.execute('plugins', {})
mcpLink = createMcpLink({ execute: (tool, args, context) => mcpTools.execute(tool, args, context), onState: ({ state: linkState, message, calls, lastTool }) => {
  const connected = linkState === 'conectado';
  $('mcp-summary').textContent = { conectado: 'connected', conectando: 'connecting', procurando: 'waiting for bridge', ocupado: 'in another tab', erro: 'error' }[linkState] ?? 'off';
  $('mcp-status').textContent = connected ? `Connected to ${message}. ${calls ? `${calls} ${calls === 1 ? 'call' : 'calls'} (last: ${lastTool}).` : 'Ask the MCP client for something.'}` : message || 'Disconnected.';
  $('mcp-status').dataset.state = connected ? 'ok' : linkState === 'erro' ? 'error' : '';
  $('mcp-connect').textContent = connected || linkState === 'conectando' ? 'Disconnect' : 'Connect';
  syncLogcatStreaming().catch(() => {});   // Logcat lines reach the page while the MCP client may ask for them
} });
// No pairing token (2026-11-20): the page looks for the bridge at its address and connects by itself; the stored settings of an older page lose their token once
let mcpAgent = 'claude';   // which agent's setup step 2 shows (Claude, Codex or Cursor)
const saveMcp = () => { try { globalThis.localStorage?.setItem(MCP_KEY, JSON.stringify({ url: $('mcp-url').value, lan: $('mcp-lan').checked, agent: mcpAgent })); } catch { /* the fields last for this page */ } };
// The two things the user copies: the terminal command that starts the bridge, and the address (inside the Claude Code command) the agent connects to.
const mcpTexts = () => {
  const port = mcpBridgePort($('mcp-url').value), lan = $('mcp-lan').checked;
  let scriptUrl = 'tools/lab-mcp.mjs'; try { scriptUrl = new URL('tools/lab-mcp.mjs', location.href).href; } catch { /* keeps the relative form */ }
  const setup = mcpAgentSetup(mcpAgent, { port, host: lan ? '<local IP the bridge shows>' : '127.0.0.1' });
  return { serve: mcpServeCommand({ port, origin: location.origin, lan, scriptUrl }), agent: setup.text, where: setup.where, link: lan ? null : setup.link };   // the one-click link needs a real address, so not in the network mode
};
const renderMcpConfig = () => {
  const texts = mcpTexts(); $('mcp-config-json').textContent = texts.serve; $('mcp-agent-command').textContent = texts.agent; $('mcp-agent-where').textContent = texts.where;
  for (const button of [...($('mcp-agent-pick').querySelectorAll?.('button') ?? [])]) button.setAttribute('aria-pressed', String(button.dataset.agent === mcpAgent));
  const link = $('mcp-agent-link'); link.hidden = !texts.link; if (texts.link) link.href = texts.link; else link.removeAttribute?.('href');
};
$('mcp-agent-pick').addEventListener('click', event => { const agent = event.target.closest?.('button')?.dataset.agent; if (!MCP_AGENTS.includes(agent)) return; mcpAgent = agent; saveMcp(); renderMcpConfig(); });
try { const saved = migrateMcpSettings(JSON.parse(globalThis.localStorage?.getItem(MCP_KEY) ?? 'null')); $('mcp-url').value = saved.url; $('mcp-lan').checked = saved.lan; if (MCP_AGENTS.includes(saved.agent)) mcpAgent = saved.agent; if (saved.changed) saveMcp(); } catch { /* storage unavailable */ }
renderMcpConfig();
$('mcp-url').addEventListener('input', () => { saveMcp(); renderMcpConfig(); });
$('mcp-url').addEventListener('change', () => { if (mcpLink.state.watching) mcpLink.watch({ url: $('mcp-url').value }); });   // another port: look there
$('mcp-lan').addEventListener('change', () => { saveMcp(); renderMcpConfig(); });
for (const [buttonId, codeId, pick] of [['mcp-copy', 'mcp-config-json', 'serve'], ['mcp-copy-agent', 'mcp-agent-command', 'agent']]) $(buttonId).addEventListener('click', async () => {
  const text = mcpTexts()[pick], button = $(buttonId);
  let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch { /* no clipboard permission: select the text instead */ }
  if (!copied) { const range = document.createRange(); $(codeId).textContent = text; range.selectNodeContents($(codeId)); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
  button.textContent = copied ? 'Copied' : 'Selected: Ctrl+C'; setTimeout(() => { button.textContent = 'Copy'; }, 1800);
});
$('mcp-connect').addEventListener('click', () => {
  if (mcpLink.connected || mcpLink.state.state === 'conectando') { mcpLink.disconnect(); return; }
  saveMcp(); mcpWatchStarted = true; mcpLink.connect({ url: $('mcp-url').value });
});
// Looking for the bridge by itself: at once where the browser does not ask before a page reaches this computer; where it would ask (a public page, Local Network Access), only once
// the user opens this section, so a visitor who never uses MCP is never asked. A hidden tab looks again when it is shown.
let mcpWatchStarted = false;
const beginMcpWatch = () => { if (mcpWatchStarted) { mcpLink.nudge(); return; } mcpWatchStarted = true; mcpLink.watch({ url: $('mcp-url').value }); };
localNetworkAccess().then(access => {
  if (access === 'granted' || access === 'unsupported') { beginMcpWatch(); return; }
  if (mcpWatchStarted) return;
  $('mcp-status').textContent = access === 'denied' ? 'This browser blocks the page from reaching this computer (site settings › Local network access): the bridge cannot be reached.' : 'Opening "Connect an agent" looks for the bridge (the browser asks once to let this page reach your computer).';
  $('mcp-status').dataset.state = access === 'denied' ? 'error' : '';
}, () => beginMcpWatch());
$('cp-mcp-setup')?.addEventListener('toggle', () => { if ($('cp-mcp-setup').open) beginMcpWatch(); });   // Controls › Extensions › MCP › Connect an agent
document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible' && mcpWatchStarted) mcpLink.nudge(); });
// "Plugins" (src/plugins-panel.js): global list, output cards under the device
// Bottom tool dock (src/tool-dock.js): Execution log, Logcat, Network, Compose and Plugins as Android Studio-like tool windows, hidden until an icon is clicked
const toolDock = createToolDock({ root: $('tool-dock'), tools: [
  { id: 'trace', label: 'Execution log', icon: '☰', details: $('trace'), count: $('trace-count') },
  { id: 'logcat', label: 'Logcat', icon: '▤', details: $('logcat'), count: $('logcat')?.querySelector?.('.logcat-count') },
  { id: 'netlog', label: 'Network', icon: '⇅', details: $('netlog'), count: $('netlog')?.querySelector?.('.netlog-count') },
  { id: 'terminal', label: 'Terminal', icon: '❯', details: $('adb-terminal'), count: $('adb-terminal')?.querySelector?.('.adb-count') },   // the adb terminal (src/adb-terminal.js): adb command lines typed by the person
  { id: 'examples', label: 'Examples', icon: '▤', details: $('scenario-catalog'), count: $('catalog-count') },   // the bundled test APKs: a dock tab, so the page itself does not scroll
  { id: 'compose', label: 'Layout', icon: '◫', details: $('compose-inspector'), count: $('compose-inspector')?.querySelector?.('.ci-count') },
  { id: 'code', label: 'Code', icon: '{}', details: $('code-browser'), count: $('code-browser')?.querySelector?.('.cb-count') },   // the Code browser (src/code-browser.js): search, smali, files, edits
  { id: 'plugins', label: 'Plugins', icon: '⧉', details: $('plugins-output'), count: $('plugins-output')?.querySelector?.('.po-count') },
] });
window.apkLabToolDock = toolDock;   // test and console access
const mocksPanel = createEndpointMocksPanel({ $, vm: apkVM });   // "Endpoint mocks" (src/endpoint-mocks.js): per package, applied live
const blockedPanel = createBlockedCallsPanel({ $, vm: apkVM, trace: line => appendTrace(line) });   // "Blocked calls" (src/blocked-calls.js): per package, applied live; the Network panel's menu and MCP use it too
const hostMapPanel = createHostMapPanel({ $, get: () => deviceState.settings.network.hostMap ?? [], set: rules => applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, network: { ...deviceState.settings.network, hostMap: rules } })) });   // "Redirect hosts" (src/host-map.js): device settings, applied live
// ---- the Controls panel's ONE Export / Import (src/config-bundle.js): the device settings and what the Controls keep for the open app, in one versioned JSON document ----------------
/** The confirmation before an import brings plugins (JavaScript the page runs): lists them (name, size, whether one is replaced, on or off) and the other parts of the same file; one yes covers the file. */
function askPluginImport(plan, lines) {
  return new Promise(resolve => {
    const box = document.createElement('div'), add = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; box.append(node); return node; };
    add('p', 'This file carries plugins. A plugin is JavaScript the page runs (it can use fetch like any script of the page): read the code in the Plugins list after the import, and cancel if you do not trust the file.', 'cp-note ov-warning');
    const list = document.createElement('ul'); list.className = 'cfg-plugins';
    for (const row of plan.rows) { const item = document.createElement('li'); item.textContent = `${row.name} · ${row.chars} characters of code · ${row.replaces !== null ? `replaces the plugin "${row.replaces}"` : 'a new plugin'} · ${row.enabled ? 'starts on' : 'stays off'}`; list.append(item); }
    box.append(list); add('p', `The rest of the file follows this answer (${lines.filter(line => !/plugin/.test(line)).join(', ') || 'nothing else'}): all of it is applied, or none.`, 'cp-note');
    const bar = document.createElement('div'); bar.className = 'cfg-plugins-actions';
    const yes = document.createElement('button'), no = document.createElement('button'); yes.type = no.type = 'button'; yes.className = no.className = 'cp-button'; yes.textContent = 'Import and run the plugins'; no.textContent = 'Cancel'; bar.append(yes, no); box.append(bar);
    let answered = false; const answer = value => { if (answered) return; answered = true; resolve(value); modal.close(); };
    const modal = modalHost.open({ title: `Import ${plan.rows.length} ${plan.rows.length === 1 ? 'plugin' : 'plugins'}?`, size: 'medium', content: box, label: 'Configuration', onClose: () => { if (!answered) { answered = true; resolve(false); } } });
    yes.addEventListener('click', () => answer(true)); no.addEventListener('click', () => answer(false)); no.focus();
  });
}
function configurationNow(parts = null, skipped = []) {
  const name = state.inventory?.packageName ?? null;
  return buildConfigDocument({ device: deviceState.settings, plugins: pluginsPanel.list(), parts, skipped, pkg: name ? { name, mocks: mocksPanel.exportMocks(), blockedCalls: blockedPanel.exportRules(), methodReturns: overridesPanel.exportRows(), ignoredActivities: ignoredPanel.exportRows(), permissions: permissionsPanel.exportConfig() } : null });
}
/** The text of the export and what it holds in words. `parts`: limit it to some parts (MCP). */
function exportConfiguration(parts = null) {
  const skipped = [], doc = configurationNow(parts, skipped), lines = describeConfigDocument(doc);
  appendTrace(`Configuration exported: ${lines.join(', ') || 'nothing'}${skipped.length ? `; not written (not finished or not valid yet): ${skipped.join('; ').slice(0, 300)}` : ''}`);
  return { doc, text: serializeConfig(doc), lines, skipped, packageName: doc.package?.name ?? null };
}
/**
 * Applies a configuration (text or an object) as if the user had set each thing by hand: validated whole first (nothing is applied when anything is wrong), then each part replaces the
 * same part of the page, which shows it, saves it and gives it to the VM like its own control does. The per-app parts go to the app that is open (the document's package name is shown
 * when it is another). -> { ok, error } or { ok, applied: [text], from, packageName }
 */
async function importConfiguration(input, source = 'the file', { confirmPlugins = false } = {}) {
  const checked = parseConfigDocument(input);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { doc, parts } = checked, name = state.inventory?.packageName ?? null;
  let plan = null;
  if (doc.plugins?.length) {   // JavaScript the page will run: never silent. The user confirms in the page (a function that asks), MCP states allowPlugins; one yes covers the whole file
    plan = planPluginImport(doc.plugins, pluginsPanel.list());
    if (plan.total > MAX_PLUGINS) return { ok: false, error: `The file's plugins would make ${plan.total} plugins; at most ${MAX_PLUGINS}. Nothing was changed.` };
    const allowed = typeof confirmPlugins === 'function' ? await confirmPlugins(plan, describeConfigDocument(doc, parts)) : confirmPlugins === true;
    if (!allowed) return { ok: false, refused: 'plugins', error: typeof confirmPlugins === 'function' ? 'You did not confirm the plugins. Nothing was changed.' : `This configuration carries ${doc.plugins.length} plugin${doc.plugins.length === 1 ? '' : 's'} (${doc.plugins.map(p => p.name).join(', ').slice(0, 200)}): JavaScript the page would run. Pass allowPlugins: true to import it, after reviewing the code. Nothing was changed.` };
  }
  if (doc.package && !name) return { ok: false, error: `This configuration has settings for the app ${doc.package.name}: open an app first (they are kept per app). Nothing was changed.` };
  if (doc.device) {
    applyDeviceSettings(sanitizeSettings(doc.device)); hostMapPanel.refresh(); permissionsPanel.refreshLocation();
    if (apkVM.worker) apkVM.setPermissions({ location: deviceState.settings.location }).catch(() => {});
  }
  if (doc.plugins) pluginsPanel.upsert(doc.plugins);
  if (doc.package?.mocks) mocksPanel.replaceMocks(doc.package.mocks);
  if (doc.package?.blockedCalls) blockedPanel.replaceAll(doc.package.blockedCalls);
  if (doc.package?.methodReturns) overridesPanel.replaceRows(doc.package.methodReturns);
  if (doc.package?.ignoredActivities) ignoredPanel.replaceRows(doc.package.ignoredActivities);
  if (doc.package?.permissions) permissionsPanel.replaceConfig(doc.package.permissions);
  const applied = describeConfigDocument(doc, parts), from = doc.package && doc.package.name !== name ? doc.package.name : null;
  if (plan) apkVM.noteConfigImport({ source, when: Date.now(), plugins: plan.rows.map(row => ({ name: row.name, chars: row.chars, replaced: row.replaces !== null })) }).catch(() => {});   // the VM's trace and Resumo (no app open: the page's trace only)
  appendTrace(`Configuration imported from ${source}: ${applied.join(', ')}${from ? ` (exported from ${from}, applied to ${name})` : ''}`);
  return { ok: true, applied, from, packageName: name };
}
{
  const status = text => { $('cfg-status').textContent = text; };
  $('cfg-export').addEventListener('click', () => {
    const { text, lines, skipped, packageName } = exportConfiguration(), blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = configFileName(packageName ?? 'device'); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported ${lines.join(', ')}${skipped.length ? `. Not written because they are not finished or not valid yet: ${skipped.join('; ').slice(0, 200)}` : ''}. Not included: ${NOT_INCLUDED}.${packageName ? '' : ' Open an app to export what the Controls keep for it.'}`);
  });
  $('cfg-import').addEventListener('click', () => $('cfg-import-file').click());
  $('cfg-import-file').addEventListener('change', async () => {
    const file = $('cfg-import-file').files?.[0]; $('cfg-import-file').value = ''; if (!file) return;
    let text; try { text = await file.text(); } catch (error) { status(`The file could not be read: ${error?.message ?? error}`); return; }
    const result = await importConfiguration(text, file.name, { confirmPlugins: askPluginImport });
    status(result.ok ? `Imported from ${file.name}: ${result.applied.join(', ')}${result.from ? ` (exported from ${result.from}, applied to ${result.packageName})` : ''}. What it set is now active, as if you had set it by hand.` : `Not imported: ${result.error}`);
  });
}
mcpControls.blocks = {
  list: () => blockedPanel.list(),
  add(spec) { const result = blockedPanel.add(spec); if (result.errors.length) throw Object.assign(new Error(result.errors.map(error => error.message).join(' ')), { code: 'bad-args' }); appendTrace(`MCP (set_block): ${spec.scope ?? 'endpoint'} rule ${spec.host ?? spec.url ?? ''}`.slice(0, 300)); return { id: result.id }; },
  remove(id) { const removed = blockedPanel.remove(id); if (removed) appendTrace(`MCP (remove_block): ${id}`); return { removed }; },
};
mcpControls.config = {
  export(parts) { const { doc, lines, skipped } = exportConfiguration(parts); return { document: doc, includes: lines, ...(skipped.length ? { notWritten: skipped } : {}), notIncluded: NOT_INCLUDED }; },
  async import(document, { allowPlugins = false } = {}) { const result = await importConfiguration(document, 'MCP (import_config)', { confirmPlugins: allowPlugins === true }); if (!result.ok) throw Object.assign(new Error(result.error), { code: 'bad-args' }); return { imported: result.applied, ...(result.from ? { exportedFrom: result.from } : {}), packageName: result.packageName }; },
};
const deviceView = createDeviceView({ $, state, deviceState, frameMeter, hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, notifyParent, clickView: id => clickView(id), hooks: {
  cameraSurface(element, info) { cameraLab.bindSurface(element, info); },
  glSurface(element, info) { glSurfaces.bind(element, info); },
  navigationChanged() {},   // Back is the device's own: its navigation bar or gesture (src/task-switcher.js), Esc on the screen or Alt+← (below), adb and the MCP tools
  closed() {
    taskSwitcher?.closed(); orientationLock.reset();   // the device shows its launcher: the app's icon starts it again
    if (state.mode === 'apk') { setStatus('App ended · no active Activity'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> ENDED'; }
  },
  rendered(snapshot, composeReady) {
    showScreenReady(snapshot.screenReady); showWarmup(snapshot.warmup); taskSwitcher?.sync(snapshot, state.inventory);
    overridesPanel.hits(snapshot.methodOverrides); methodHooksPanel.update(snapshot.methodHooks); netRoutes.update(snapshot.netRoutes); microgEntriesPanel.update(snapshot.deviceOptions?.microg?.entryPoints ?? null); microgServicesPanel.update(snapshot.deviceOptions?.microg?.services ?? null, state.loadedMicrog); ignoredPanel.hits(snapshot.ignoredActivities); mocksPanel.hits(snapshot.endpointMocks); blockedPanel.hits(snapshot.blockedCalls); hostMapPanel.hits(snapshot.hostMap);
    hideBoot({ force: true }); $('empty-preview').hidden = true; updateMemoryMeter(snapshot.vmHealth); showCoreUsage(snapshot.vmHealth); state.lastSnapshot = snapshot; redrawLayoutBounds(); syncFrameGraph(); if (snapshot.vmHealth) { const before = JSON.stringify(state.lastVmHealth?.clientIdentity ?? null); state.lastVmHealth = snapshot.vmHealth; if (JSON.stringify(snapshot.vmHealth.clientIdentity ?? null) !== before) showClientCertState(); } if (snapshot.vmHealth?.renderer) showRendererStatus(snapshot.vmHealth.renderer, true); composeInspector.rendered(snapshot); pluginHost.snapshot(snapshot);
    if (snapshot.droppedEvent) appendTrace(`Event dropped: View ${snapshot.droppedEvent.id} (${snapshot.droppedEvent.type}) no longer exists in the VM.`);
    // The VM raised java.lang.OutOfMemoryError (even if the app caught it): never silent.
    if ((snapshot.vmHealth?.oomCount ?? 0) > (state.oomSeen ?? 0)) { state.oomSeen = snapshot.vmHealth.oomCount; appendTrace(`OutOfMemoryError: ${snapshot.vmHealth.lastOom?.reason} (${snapshot.vmHealth.liveObjects} live objects)`); setStatus(`java.lang.OutOfMemoryError in the VM (${snapshot.vmHealth.liveObjects} live objects, limit ${snapshot.vmHealth.limit})`, 'error'); }
    if (state.mode === 'apk') { $('runtime-badge').className = 'runtime-badge running'; $('runtime-badge').innerHTML = '<span></span> RUNNING'; $('preview-name').textContent = snapshot.activityName?.split('.').pop() || state.inventory?.packageName || 'Local APK'; if (composeReady === false) { $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> STARTED'; setStatus('Activity started · composition has no accessible, drawn content yet'); } else setStatus('Activity running · interact with the UI', 'ok'); }
    taskSwitcher?.restate();
    orientationLock.show(state.mode === 'apk' && !snapshot.closed && !snapshot.navigation?.taskInBackground ? snapshot.orientationLock : null);
  },
} });
const { renderSnapshot, flushPendingInputs, updateSystemBarIcons } = deviceView; deviceView.bindVM(apkVM);
const appPalette = createAppPalette({ origin: () => $('android-screen') });   // src/app-palette.js: the page in the open app's colours, as soon as the launcher knows its icon (task switcher onIcon: the stored icon of a saved app, then the VM's)
window.apkLabPalette = appPalette;   // test and console access: .state
taskSwitcher = createTaskSwitcher({ dismiss: () => dismissApp(), opening: () => !!state.opening, shelf: { open: id => openSavedApp(id), remove: item => removeSavedApp(item), hasPackage: item => !!state.inventory && (item.current || item.id === state.shelfId), package: () => showPackageWindow() }, onInfo: info => { state.launcherInfo = { inventory: state.inventory, info }; describeSavedApp(); appInfo.render(); }, onIcon: url => { if (url) { if (state.opening) state.paletteAfterOpen = url; else appPalette.fromURL(url); } if (state.bootVisible) showBootIcon(url); } /* the page's colours change once the app opened: their reveal (a View Transition) takes every tap and gesture of the page while it runs */, $, vm: () => state.runtime, render: snapshot => renderSnapshot(snapshot), back: () => backAPK(), relaunch: () => runAPK(), canGoBack: () => !!state.canGoBack, busy: () => state.busy || !state.runtime,
  begin: message => beginOperation(message), finish: token => finishOperation(token), report: (message, error) => { if (error) reportAPKError(error, 'Device navigation'); else appendTrace(message); },
  announce: mode => { if (state.mode !== 'apk' || !['overview', 'home', 'closed'].includes(mode)) return; setStatus(mode === 'closed' ? 'App ended · tap its icon to open it again' : 'App in the background (onPause, onStop) · tap to go back'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = mode === 'closed' ? '<span></span> ENDED' : '<span></span> PAUSED'; } });
// The stage changes size when the window does or a dock panel opens (the workspace fills the viewport above the dock): the device is fitted again.
// "−  70%  +" over the stage's top right corner (src/device-zoom.js): the device's scale on the stage; the label resets to "fit".
const refitDevice = () => { if (deviceState.bars) deviceView.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); else { const d = resolveDevice(deviceState.settings); deviceView.fitDevice(d.widthDp, d.heightDp); } };
const deviceZoom = createDeviceZoom({ stage: $('preview-stage'), deviceState, refit: refitDevice, shownScale: () => Number($('android-device')?.style?.getPropertyValue?.('--scale')) || 0.7 });
if (typeof ResizeObserver === 'function' && $('preview-stage')) new ResizeObserver(() => { const stage = $('preview-stage'); stage.style.setProperty('--stage-h', `${stage.clientHeight}px`); deviceZoom?.sync(); if (deviceState.bars) deviceView.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); }).observe($('preview-stage'));
createDeviceFullscreen({ stage: $('preview-stage'), openButton: $('fullscreen-button'), closeButton: $('fullscreen-close'), deviceState, refit: () => { if (deviceState.bars) deviceView.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); } });   // "Full screen" (src/device-fullscreen.js): CSS scale only
const customScreenPanel = createCustomScreenPanel({ $ });   // "Screen" -> "Custom" (src/custom-screen-panel.js)
// ---- Virtual device settings panel ("Virtual device") ----
// Language and Region of the device: the locale is language-REGION (any ISO 3166 country with any of these languages: en-BR, pt-PT ...). Names come from the browser's Intl.DisplayNames.
const DEVICE_LANGUAGE_CODES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'ar', 'he', 'hi', 'ja', 'ko', 'zh'];
const displayName = (type, code) => { try { return new Intl.DisplayNames(['en-US'], { type }).of(code) ?? code; } catch { return code; } };
const capital = text => text.charAt(0).toLocaleUpperCase('en-US') + text.slice(1);
const DEVICE_LANGUAGES = DEVICE_LANGUAGE_CODES.map(code => [code, `${capital(displayName('language', code))}${code === 'ar' || code === 'he' ? ' (RTL)' : ''}`]);
const DEVICE_REGIONS = Object.keys(ISO_COUNTRIES).map(code => [code, `${displayName('region', code)} (${code})`]).sort((a, b) => a[1].localeCompare(b[1], 'en-US'));
const DEVICE_ZONES = [['', 'Follow the browser'], ['America/Sao_Paulo', 'São Paulo (UTC−3)'], ['UTC', 'UTC'], ['America/New_York', 'New York'], ['Europe/London', 'London'], ['Europe/Paris', 'Paris'], ['Asia/Kolkata', 'India (UTC+5:30)'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney']];
const DEVICE_SCREENS = [['phone', 'Phone · 411 × 914 dp'], ['compact', 'Compact · 360 × 800 dp'], ['large', 'Large · 412 × 892 dp'], ['small', 'Small · 320 × 640 dp'], ['tablet', 'Tablet · 800 × 1280 dp'], ['custom', 'Custom…']];
const fillSelect = (select, entries) => { select.replaceChildren(...entries.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; })); };
/** The line under Dispositivo › Proxy: whether what is typed is in use, off, or refused (and so off). */
let proxyTyping = false;   // the Proxy field's own input is being applied: writeDevicePanel leaves the field as typed
/** The On/Off pill of the mTLS field and the line under it: what is configured and what the running app did with it (vmHealth.clientIdentity). */
function showClientCertState() {
  const pill = $('dev-client-cert-state'), note = $('dev-client-cert-status'); if (!pill || !note) return;
  const hosts = ($('dev-client-cert')?.value ?? '').split(/[\s,]+/).filter(Boolean), proxyText = $('dev-proxy')?.value ?? '', proxyUrl = effectiveProxy(proxyState(proxyText).state === 'on' ? proxyText : '', relayDetection()).url;
  const { state: shown, label, text } = clientIdentityStatus({ hosts, auto: $('dev-client-cert-auto')?.checked !== false, proxyUrl, entries: state.lastVmHealth?.clientIdentity ?? null });
  pill.textContent = label; pill.dataset.state = shown; note.textContent = text; note.dataset.state = shown === 'error' ? 'error' : shown === 'ok' ? 'ok' : shown === 'warn' ? 'warn' : '';
}
function showProxyState() {
  const note = $('dev-proxy-note'); if (!note) return; const { state: shown, text, action } = proxyState($('dev-proxy')?.value ?? '', relayDetection(), { inUse: state.apkRunning ? state.runProxy ?? null : null });
  note.textContent = text; note.dataset.state = shown === 'refused' ? 'error' : shown === 'on' || shown === 'auto' ? 'ok' : '';
  if (action === 'look' && typeof document?.createElement === 'function') { const button = document.createElement('button'); button.type = 'button'; button.className = 'cp-button'; button.textContent = 'Look for the relay'; button.addEventListener('click', () => { relayDetector.check({ gesture: true, maxAgeMs: 0 }).catch(() => {}); }); note.append(' ', button); }
  showClientCertState(); showRelayChannelState();
}
/** The line under "Parallel relay channel" (src/relay-mux.js): off, on, or on but without a relay to carry it. */
function showRelayChannelState() { const note = $('dev-relay-channel-note'); if (!note) return; const { state, text } = relayChannelState($('dev-relay-channel')?.checked === true, $('dev-proxy')?.value ?? '', relayDetection()); note.textContent = text; note.dataset.state = state === 'warn' ? 'warn' : state === 'on' ? 'ok' : ''; }
// The APK Lab Relay found by itself (src/relay-detect.js): the device's Proxy while the field is empty. Looked for on load, when Device opens, and before an APK is loaded or
// launched; the proxy a run was given is state.runProxy (recorded in the execution log), changed only at a load, a launch or a device change, never mid-exchange.
const relayDetector = createRelayDetector({ onChange: () => { try { showProxyState(); } catch { /* the panel is not built yet */ } } });
function relayDetection() { try { return relayDetector.state; } catch { return null; } }   // null while the detector is not created yet (early callers)
/** The proxy the device uses for these settings: the field (custom), else the relay found by itself, else none. */
function proxyInUse(settings = deviceState.settings) { return effectiveProxy(settings?.network?.proxyUrl, relayDetection()); }
/** The device model for the VM, with the proxy in use. */
function vmDevice(settings) { const proxy = proxyInUse(settings); return deviceForVM({ ...settings, network: { ...settings.network, proxyUrl: proxy.url } }); }
/** Look for the relay again (cheap: a fresh answer is reused, the probe is bounded); never fails a run. */
async function refreshRelay() { try { await relayDetector.check(); } catch { /* no relay then */ } }
/** Before a launch: a relay that started (or stopped) since the APK was loaded becomes the device's proxy now, before any code of the app runs, and the log says so. */
async function syncRunProxy() {
  await refreshRelay();
  const proxy = proxyInUse(); if (!state.runtime || proxy.url === (state.runProxy?.url ?? '')) return;
  try { await state.runtime.setDevice(vmDevice(deviceState.settings)); state.runProxy = proxy; appendTrace(`${describeProxyForTrace(proxy)}; set before the launch`); showProxyState(); }
  catch (error) { appendTrace(`Network proxy: not changed before the launch (${error?.message ?? error})`); }
}
relayDetector.check().catch(() => {});
$('cp-sec-network')?.addEventListener('toggle', () => { if ($('cp-sec-network').open) refreshRelay(); });
function writeDevicePanel(settings) {
  $('dev-screen').value = settings.screen; $('dev-orientation').value = settings.orientation; $('dev-font').value = String(settings.fontScale); $('dev-font-out').textContent = `${settings.fontScale.toFixed(2)}×`;
  { const [language, region] = String(settings.locale).split('-'); $('dev-locale').value = language; if ($('dev-region')) $('dev-region').value = region; } $('dev-dark').checked = settings.darkTheme; $('dev-animator').value = String(settings.animatorScale); $('dev-hour24').checked = settings.hour24; $('dev-tz').value = settings.timeZone;
  $('dev-battery').value = String(settings.battery.level); $('dev-battery-out').textContent = `${settings.battery.level}%`; $('dev-charging').checked = settings.battery.charging; $('dev-network').value = settings.connectivity; $('dev-nav').value = settings.navigation; { const all = settings.network.allowedHosts.includes('*'); $('dev-hosts-all').checked = all; $('dev-hosts').disabled = all; $('dev-hosts').value = all ? '*' : settings.network.allowedHosts.join(', '); } $('dev-layout-bounds').checked = !!settings.layoutBounds; $('dev-frame-graph').checked = !!settings.frameGraph; if (!proxyTyping) $('dev-proxy').value = settings.network.proxyUrl; if ($('dev-client-cert')) $('dev-client-cert').value = (settings.network.clientCertHosts ?? []).join(', '); if ($('dev-client-cert-auto')) $('dev-client-cert-auto').checked = settings.network.clientCertAuto !== false; if ($('dev-relay-channel')) $('dev-relay-channel').checked = settings.network.relayChannel === true; showProxyState();   /* not from its own typing: a URL half typed (or refused) is not kept, and rewriting the field erased it; the line under it says what is in use */ if ($('vm-memory')) $('vm-memory').value = String(settings.memoryMiB); writeCoreMemory(settings.coreMemory);
  if ($('vm-event-time')) $('vm-event-time').value = String(settings.eventSeconds ?? 0);
  if ($('vm-renderer')) $('vm-renderer').value = settings.renderer ?? 'gpu'; showEngine(settings);
  if ($('vm-raster-scale')) $('vm-raster-scale').value = String(settings.raster?.motionScale ?? 1); if ($('vm-raster-still')) $('vm-raster-still').value = String(settings.raster?.stillScale ?? 1); if ($('vm-raster-navigation')) $('vm-raster-navigation').checked = settings.raster?.navigation === true;
  customScreenPanel.write(settings);
  if ($('dev-arm64')) $('dev-arm64').checked = settings.arm64Native === true;
  if ($('dev-arm64-translate')) $('dev-arm64-translate').checked = settings.arm64Translate !== false;
  if ($('dev-gles-cpu')) $('dev-gles-cpu').checked = settings.glesCpu === true;
  if ($('dev-microg')) $('dev-microg').checked = settings.microg === true; updateMicrogHint(settings); customIdentityPanel().write(settings.customIdentity); updateCustomIdentityHint(settings); updateIdentityNote(settings); microgServicesPanel.write(settings);
  if ($('vm-hardware-window')) $('vm-hardware-window').checked = settings.hardwareWindow !== false;
  if ($('vm-scheduling-25')) $('vm-scheduling-25').checked = settings.schedulingOf25 === true;
  if ($('vm-prepare-last-run')) $('vm-prepare-last-run').checked = settings.prepareFromLastRun !== false;
  if ($('vm-load-image')) $('vm-load-image').checked = settings.loadImage === true;
  const device = resolveDevice(settings); $('device-summary').textContent = `${device.widthDp} × ${device.heightDp} · ${settings.orientation === 'landscape' ? 'landscape' : 'portrait'}`;
}
function readDevicePanel() {
  return sanitizeSettings({ screen: $('dev-screen').value, customScreen: customScreenPanel.read(deviceState.settings.customScreen), orientation: $('dev-orientation').value, fontScale: Number($('dev-font').value), locale: `${$('dev-locale').value}-${$('dev-region')?.value || 'US'}`, darkTheme: $('dev-dark').checked, animatorScale: Number($('dev-animator').value),
    hour24: $('dev-hour24').checked, timeZone: $('dev-tz').value, battery: { level: Number($('dev-battery').value), charging: $('dev-charging').checked }, connectivity: $('dev-network').value, navigation: $('dev-nav').value, layoutBounds: $('dev-layout-bounds').checked, frameGraph: $('dev-frame-graph').checked, arm64Native: $('dev-arm64')?.checked === true, arm64Translate: $('dev-arm64-translate')?.checked !== false, glesCpu: $('dev-gles-cpu')?.checked === true, hardwareWindow: $('vm-hardware-window') ? $('vm-hardware-window').checked : true, schedulingOf25: $('vm-scheduling-25') ? $('vm-scheduling-25').checked : false, prepareFromLastRun: $('vm-prepare-last-run') ? $('vm-prepare-last-run').checked : true, microg: $('dev-microg')?.checked === true, microgServices: microgServicesPanel.read(), customIdentity: customIdentityPanel().read(), loadImage: $('vm-load-image')?.checked === true, eventSeconds: Number($('vm-event-time')?.value ?? 0), raster: { motionScale: Number($('vm-raster-scale')?.value ?? 0.5), navigation: $('vm-raster-navigation')?.checked === true, stillScale: Number($('vm-raster-still')?.value ?? 1) }, renderer: $('vm-renderer')?.value ?? 'gpu', engine: URL_ENGINE ? deviceState.settings?.engine ?? DEFAULT_ENGINE : $('vm-engine')?.value ?? DEFAULT_ENGINE, coreMemory: readCoreMemory(), network: { allowedHosts: $('dev-hosts-all').checked ? ['*'] : $('dev-hosts').value.split(/[\s,]+/).filter(host => host !== '*'), proxyUrl: $('dev-proxy').value, hostMap: deviceState.settings.network?.hostMap ?? [], clientCertHosts: ($('dev-client-cert')?.value ?? '').split(/[\s,]+/).filter(Boolean), clientCertAuto: $('dev-client-cert-auto') ? $('dev-client-cert-auto').checked : true, relayChannel: $('dev-relay-channel')?.checked === true }, memoryMiB: Number($('vm-memory')?.value ?? 0), location: deviceState.settings.location });
}
// "VM memory": the Java heap budget (object limit) used at the next load; the VM limit of each step is memoryBudget({ override }).maxHeapObjects, the same rule the Worker applies (heapLimitFor).
const vmMemoryLabel = mibValue => { const { maxHeapObjects } = memoryBudget({ override: mibValue }); return `${mibValue >= 1024 ? `${mibValue / 1024} GiB` : `${mibValue} MiB`} · ${maxHeapObjects.toLocaleString('en-US')} objects`; };
function initVmEventTime() {
  const select = $('vm-event-time'); if (!select) return;
  fillSelect(select, [['0', 'Automatic (default) · 25 s per event'], ...EVENT_SECONDS_STEPS.map(value => [String(value), value >= 120 ? `${value / 60} min per event` : `${value} s per event`])]);
}
function initVmMemory() {
  const select = $('vm-memory'); if (!select) return;
  const auto = memoryBudget({ deviceMemory: globalThis.navigator?.deviceMemory ?? null });
  fillSelect(select, [['0', `Automatic (default) · ${auto.budgetMiB} MiB · ${auto.maxHeapObjects.toLocaleString('en-US')} objects`], ...MEMORY_STEPS_MIB.map(value => [String(value), vmMemoryLabel(value)])]);
  const device = globalThis.navigator?.deviceMemory; $('vm-memory-device').textContent = device != null ? `This browser reports ${device} GiB of device memory.` : 'This browser does not report the device memory.';
}
// "Rendering": the backend in use (the GPU's name when the browser exposes it) and why the GPU is not in use after a fallback.
let rendererShown = '';
function showRendererStatus(status, fromSnapshot = false) {
  const note = $('vm-renderer-status'); if (!note) return;
  const key = status ? `${status.requested}|${status.active}|${status.reason ?? ''}|${status.gpuRenderer ?? ''}` : ''; if (fromSnapshot && key === rendererShown) return;
  if (status?.reason && status.reason !== rendererShown.split('|')[2] && status.requested === 'gpu') appendTrace(`GPU unavailable: ${status.reason} — using CPU`);
  rendererShown = key;
  const requested = deviceState.settings?.renderer ?? 'gpu';
  if (!status) { note.textContent = requested === 'gpu' ? 'GPU selected: it starts when an app draws its first frame' : 'In use: CPU'; note.dataset.state = ''; note.title = note.textContent; return; }   // no app drawing yet: say what was chosen, not "CPU"
  if (status.active === 'gpu') { note.textContent = `In use: GPU (${status.api ?? 'WebGL'}${status.gpuRenderer ? ` · ${status.gpuRenderer}` : ''})`; note.dataset.state = 'gpu'; }
  else if (status.requested === 'gpu' || (requested === 'gpu' && status.reason)) { note.textContent = `GPU unavailable: ${status.reason ?? 'unknown reason'} — using CPU`; note.dataset.state = 'fallback'; }
  else { note.textContent = 'In use: CPU'; note.dataset.state = ''; }
  note.title = note.textContent;
}
// "With microG" is read by `load` (the Worker installs the microG packages then): the hint shows while the open APK runs with the other choice.
/** The identity the page describes (src/device-identity.js): that of the running app (its ABI option and the custom identity it was opened with), else what the panel holds. */
function identitySource(settings = deviceState.settings) {
  const custom = state.runCustomIdentity !== undefined ? state.runCustomIdentity : customIdentityForLoad(settings);
  return { arm64: state.runArm64 ?? settings?.arm64Native === true, customIdentity: customIdentityFor(custom) };
}
/** The Device panel's identity line: the lab's identity, the same for every app, or the custom one the user typed (marked so); the ABIs follow the ARM64 option. */
function updateIdentityNote(settings = deviceState.settings) { const note = $('dev-identity'); if (!note) return; const source = identitySource(settings); note.textContent = `Identity${source.customIdentity ? '' : ' (fixed, the same for every app)'}: ${identityText(source, { customLabel: 'custom identity, typed by you' })}. System packages are signed with the lab's own platform key.`; note.dataset.state = source.customIdentity ? 'custom' : ''; }
// "Custom device identity" (src/custom-identity-panel.js) is read by `load`: the hint shows while the open APK runs with another identity than the one the panel would apply.
function customIdentityPanel() { return (customIdentityPanel.instance ??= createCustomIdentityPanel({ byId: id => $(id) })); }   // made on first use: the Device panel is written before this line runs
function updateCustomIdentityHint(settings = deviceState.settings) { const hint = $('dev-id-hint'); if (hint) hint.hidden = !(apkVM.worker && state.runCustomIdentity !== undefined && JSON.stringify(state.runCustomIdentity) !== JSON.stringify(customIdentityForLoad(settings))); }
function updateMicrogHint(settings = deviceState.settings) { const badge = $('dev-microg-summary'); if (badge) badge.textContent = settings?.microg === true ? 'with microG' : 'no microG';   // the option's state shows on the section's row, open or closed
  const hint = $('dev-microg-hint'); if (hint) hint.hidden = !(apkVM.worker && state.loadedMicrog !== undefined && state.loadedMicrog !== (settings?.microg === true)); microgSettings.refresh(); }
// The hint shows while a loaded APK was opened with another budget than the one selected now (the budget is read by `load`, never applied live).
function updateVmMemoryHint() { const hint = $('vm-memory-hint'); if (hint) hint.hidden = !(apkVM.worker && state.loadedMemoryMiB !== undefined && state.loadedMemoryMiB !== deviceState.settings.memoryMiB); const core = $('vm-core-hint'); if (core) core.hidden = !(apkVM.worker && state.loadedCoreMemory && !sameCoreMemory(state.loadedCoreMemory, deviceState.settings.coreMemory)); const engine = $('vm-engine-hint'); if (engine) engine.hidden = !(apkVM.worker && state.loadedEngine && state.loadedEngine !== engineForLoad()); }
/* "VM engine": the WebAssembly core (default) or the JavaScript VM, read by `load`. `?engine=js|wasm` in the address wins over the stored choice and locks the select. */
const URL_ENGINE = ['js', 'wasm'].includes(params.get('engine')) ? params.get('engine') : null;
function engineForLoad() { return URL_ENGINE ?? deviceState.settings?.engine ?? DEFAULT_ENGINE; }
function showEngine(settings) {
  const select = $('vm-engine'), note = $('vm-engine-note'); if (!select) return;
  select.value = URL_ENGINE ?? settings.engine ?? DEFAULT_ENGINE; select.disabled = !!URL_ENGINE;
  if (note) note.textContent = URL_ENGINE ? `Set by the page address (?engine=${URL_ENGINE}); remove the parameter to choose here.` : select.value === 'js' ? 'JavaScript VM: the memory is the one in "VM memory"; the Wasm core fields do not apply.' : 'WebAssembly core: the memory is the one in "Wasm core memory"; "VM memory" does not apply.';
}
// "Wasm core memory" (src/core-memory.js): heap, metaspace and live threads of the WebAssembly core, read by the next load. A combination that does not fit the core's
// 2 GiB is shown as an error and not saved (the last valid one stays).
const CORE_FIELDS = [['vm-core-heap', 'heapMiB'], ['vm-core-meta', 'metaMiB'], ['vm-core-threads', 'threads']];
/** The form as typed: the mode and the three sizes (in dynamic mode the heap and thread sizes stay in their fields, unused, for when the mode is switched back). */
const rawCoreMemory = () => ({ mode: $('vm-core-mode')?.value ?? CORE_MEMORY_DEFAULT.mode, ...Object.fromEntries(CORE_FIELDS.map(([id, key]) => [key, $(id)?.value ?? ''])) });
function showCoreMode(mode) { const box = $('vm-core'); if (box) box.dataset.mode = mode; for (const id of ['vm-core-heap', 'vm-core-threads']) { const input = $(id); if (input) input.disabled = mode === 'dynamic'; } }
function writeCoreMemory(memory) { const mode = $('vm-core-mode'); if (mode) mode.value = memory.mode; showCoreMode(memory.mode); for (const [id, key] of CORE_FIELDS) { const input = $(id); if (input && document.activeElement !== input) input.value = String(memory[key]); } showCoreMemoryTotal(memory); }
function showCoreMemoryTotal(raw) {
  const note = $('vm-core-total'); if (!note) return null; const checked = checkCoreMemory(raw);
  note.dataset.state = checked.error ? 'error' : ''; note.textContent = checked.error ? `Does not fit: ${checked.error}. The last valid value is kept.` : checked.value.mode === 'dynamic' ? `Heap and threads share ${checked.areaMiB} MiB on demand (the heap starts at 64 MiB)${sameCoreMemory(checked.value, CORE_MEMORY_DEFAULT) ? ' (default)' : ''}.` : `Fixed total: ${checked.totalMiB} of 2048 MiB.`;
  return checked;
}
/** What the running core uses of each region (from the frame's vmHealth), under the fields; hidden on the JavaScript VM. */
let coreUsageShown = '';
function showCoreUsage(health) {
  const note = $('vm-core-usage'); if (!note) return; const core = health?.core ?? null, mib = bytes => Math.round(bytes / 1048576);
  const live = core?.liveBytes != null ? ` (${mib(core.liveBytes)} MiB live at the last collection)` : '';
  const text = !core ? '' : core.dynamic ? `In use now: metaspace ${mib(core.metaBytes)} of ${mib(core.metaCapacity)} MiB · ${core.threads} threads · heap of ${mib(core.heapBytes)} MiB${live} · heap and threads take ${mib(core.areaBytes)} of ${mib(core.areaLimit)} MiB.`
    : `In use now: metaspace ${mib(core.metaBytes)} of ${mib(core.metaCapacity)} MiB · ${core.threads} of ${core.threadCapacity} threads · heap of ${mib(core.heapBytes)} MiB${live}.`;
  if (text === coreUsageShown) return; coreUsageShown = text; note.hidden = !text; note.textContent = text;
}
function readCoreMemory() {
  const raw = rawCoreMemory(), checked = showCoreMemoryTotal(raw);
  return !checked || checked.error ? deviceState.settings.coreMemory : checked.value;
}
let deviceApplying = Promise.resolve();
function applyDeviceSettings(settings) {
  const rendererChanged = (deviceState.settings?.renderer ?? 'cpu') !== (settings.renderer ?? 'cpu');
  const timeChanged = (deviceState.settings?.eventSeconds ?? 0) !== (settings.eventSeconds ?? 0), rasterChanged = JSON.stringify(deviceState.settings?.raster ?? null) !== JSON.stringify(settings.raster ?? null);
  const vmDeviceChanged = !deviceState.settings || JSON.stringify(vmDeviceModel(deviceState.settings)) !== JSON.stringify(vmDeviceModel(settings));   // only what the running app sees goes through the exclusive 'device' RPC
  deviceState.settings = settings; updateVmMemoryHint(); saveDeviceSettings(settings);
  if (rasterChanged && apkVM.worker && params.get('raster') !== 'full') apkVM.setRasterSettings({ scale: settings.raster.motionScale, navigation: settings.raster.navigation, settled: settings.raster.stillScale }).catch(() => {});   // "Resolution while moving" / "New screen starts at low resolution" (src/motion-raster.js)
  if (rendererChanged) { if (apkVM.worker) apkVM.setRenderer(settings.renderer).then(showRendererStatus, error => showRendererStatus({ requested: settings.renderer, active: 'cpu', reason: String(error?.message ?? error) })); else showRendererStatus(null); }   // "Rendering" applies live (src/gpu-raster.js)
  if (timeChanged && apkVM.worker) apkVM.setTimeLimits(settings.eventSeconds).catch(() => {});   // "Maximum time per event" applies to the running VM at once (src/time-limits.js)
  writeDevicePanel(settings); updateSystemBarIcons(); redrawLayoutBounds(); syncFrameGraph();
  const note = $('device-status');
  if (state.runtime !== apkVM || !state.apkRunning) { note.textContent = 'No app is running: the settings apply from the next launch.'; return deviceApplying; }
  if (!vmDeviceChanged) return deviceApplying;   // motion/still resolution, renderer, time per event: applied above on their own side channels; no exclusive VM operation that would refuse the user's input
  // One RPC at a time: wait for a VM operation in flight, then deliver the newest settings through ActivityThread semantics.
  deviceApplying = deviceApplying.then(async () => {
    for (let attempt = 0; attempt < 100 && apkVM.pending; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    const latest = deviceState.settings;
    try {
      const { outcome, snapshot } = await apkVM.setDevice(vmDevice(latest));
      { const proxy = proxyInUse(latest); if (proxy.url !== (state.runProxy?.url ?? '')) { state.runProxy = proxy; appendTrace(`${describeProxyForTrace(proxy)}; applied live`); showProxyState(); } }
      if (snapshot) renderSnapshot(snapshot);
      note.textContent = outcome?.changed ? `Applied live: ${outcome.relaunched ? `${outcome.relaunched} Activity(ies) recreated with saved state` : ''}${outcome.relaunched && outcome.delivered ? ' · ' : ''}${outcome.delivered ? `${outcome.delivered} onConfigurationChanged` : ''}${!outcome.relaunched && !outcome.delivered ? 'no Configuration change (status bar, network/battery/time zone)' : ''}.` : 'No change for the app.';
    } catch (error) { note.textContent = 'The app did not accept the change: ' + (error?.message || error); reportAPKError(error, 'Device configuration change interrupted'); }
  });
  return deviceApplying;
}
function initDevicePanel() {
  fillSelect($('dev-screen'), DEVICE_SCREENS); fillSelect($('dev-locale'), DEVICE_LANGUAGES); if ($('dev-region')) fillSelect($('dev-region'), DEVICE_REGIONS); fillSelect($('dev-tz'), DEVICE_ZONES); initVmMemory(); initVmEventTime(); writeDevicePanel(deviceState.settings); syncFrameGraph();
  for (const id of ['dev-screen', 'dev-custom-w', 'dev-custom-h', 'dev-custom-unit', 'dev-orientation', 'dev-font', 'dev-locale', 'dev-region', 'dev-dark', 'dev-animator', 'dev-hour24', 'dev-tz', 'dev-battery', 'dev-charging', 'dev-network', 'dev-nav', 'dev-hosts-all', 'dev-client-cert-auto', 'dev-layout-bounds', 'dev-frame-graph', 'dev-arm64', 'dev-arm64-translate', 'dev-gles-cpu', 'vm-hardware-window', 'vm-scheduling-25', 'vm-prepare-last-run', 'dev-microg', 'dev-hosts', 'dev-proxy', 'dev-relay-channel', 'dev-client-cert', 'vm-memory', 'vm-event-time', 'vm-raster-scale', 'vm-raster-still', 'vm-raster-navigation', 'vm-renderer', 'vm-engine', 'vm-load-image']) $(id).addEventListener('input', () => { if (id === 'dev-proxy') { showProxyState(); proxyTyping = true; } if (id === 'dev-client-cert' || id === 'dev-client-cert-auto') showClientCertState(); if (id === 'dev-relay-channel') showRelayChannelState(); try { applyDeviceSettings(readDevicePanel()); } finally { proxyTyping = false; } });
  for (const [id] of CORE_FIELDS) { $(id)?.addEventListener('change', () => { if (showCoreMemoryTotal(rawCoreMemory())?.error) return; applyDeviceSettings(readDevicePanel()); }); /* a combination that does not fit stays on screen with its reason, and is not applied */ $(id)?.addEventListener('input', () => { showCoreMemoryTotal(rawCoreMemory()); }); }
  $('vm-core-mode')?.addEventListener('change', () => { showCoreMode($('vm-core-mode').value); if (showCoreMemoryTotal(rawCoreMemory())?.error) return; applyDeviceSettings(readDevicePanel()); });   // switching to "Fixed" with sizes that do not fit shows why and keeps the mode that was running
  $('vm-core-reset')?.addEventListener('click', () => { $('vm-core-mode').value = CORE_MEMORY_DEFAULT.mode; for (const [id, key] of CORE_FIELDS) $(id).value = String(CORE_MEMORY_DEFAULT[key]); applyDeviceSettings(readDevicePanel()); });
  document.querySelector('#trace .trace-actions')?.addEventListener('click', event => event.preventDefault());   // buttons in the <summary> must not toggle the panel
  // "Custom device identity": every keystroke shows the field's error at once and stores the block as typed (a load applies it only when valid); "Reset to the lab's identity"
  // turns it off and empties every field
  customIdentityPanel().init();
  for (const id of ['dev-id-on', 'dev-id-manufacturer', 'dev-id-brand', 'dev-id-model', 'dev-id-device', 'dev-id-name', 'dev-id-board', 'dev-id-hardware']) $(id)?.addEventListener('input', () => applyDeviceSettings(readDevicePanel()));
  $('dev-id-reset')?.addEventListener('click', () => { for (const input of document.querySelectorAll('#dev-id input[type=text]')) input.value = ''; applyDeviceSettings({ ...deviceState.settings, customIdentity: sanitizeCustomIdentity(null) }); });
  $('device-reset').addEventListener('click', () => { applyDeviceSettings(defaultDeviceSettings()); hostMapPanel.refresh(); permissionsPanel.refreshLocation(); if (apkVM.worker) apkVM.setPermissions({ location: deviceState.settings.location }).catch(() => {}); });
}
// ---- "Open": a deep link / Intent resolved against the manifest's intent filters (src/deep-link-host.js) ----
async function runAPK() {
  if (!(state.runtime || (state.needsRestart && state.currentSource)) || state.busy || state.runStarting) return;
  if (state.inventory?.unsupportedFeatures?.length) { endOpening(state.opening); switchMode('apk'); showDeviceHome('installed'); showError(new Error(`This APK cannot be run yet: ${state.inventory.unsupportedFeatures.join('; ')}`), 'File limit'); return; }   // the launcher icon of an APK the lab cannot run says why
  const starts = !state.opening;   // a tap on its icon: the open starts here (with a read when its VM is replaced); after a load that opens right away it goes on
  if (starts) beginOpening().stage = state.launchAttempted || state.needsRestart ? 'read' : 'open';
  const session = state.opening;
  state.runStarting = true;
  if (starts && taskSwitcher && deviceView && !state.apkRunning) { showDeviceFrame(); taskSwitcher.launching(); }
  showBoot(OPENING_MESSAGE[session.stage]); if (starts && state.mode === 'apk') setStatus(OPENING_MESSAGE[session.stage]);
  try { await runAPKOnce(); } finally { state.runStarting = false; endOpening(session); }
}
async function runAPKOnce(retried = false) {
  await flushPendingInputs();
  if (state.launchAttempted || state.needsRestart) {   // a second run, or a run after a failure: the APK is reopened in a fresh Worker (a VM left busy or broken by the failure is replaced)
    const source = state.currentSource;
    if (!source) return;
    await importSource(source);
    if (!state.runtime || state.busy) return;
  }
  await taskSwitcher?.infoSettled?.();   // the launcher's label and icon request of the load just finished (the VM client takes one request at a time)
  await syncRunProxy();   // a relay started (or stopped) since the load: the proxy the app starts with
  switchMode('apk'); hideError(); state.lastAPKError = null; state.stickyError = false; state.launchAttempted = true;
  if (!state.bootVisible) showBoot(OPENING_MESSAGE.open);   // the starting window, if a failure took it away
  const token = beginOperation(OPENING_MESSAGE.open); openingStage('open');
  state.runStartedAt = Date.now(); const launchStarted = performance.now();
  try { const snapshot = await state.runtime.launch(activityToLaunch(), { onProgress: onWorkerProgress }); if (token === state.operation) { renderSnapshot(snapshot); if ($('cp-sec-data')?.open) setTimeout(() => appDataPanel.refresh(), 0); if (state.loadTimes) { state.loadTimes.launchMs = Math.round(performance.now() - launchStarted); state.loadTimes.totalMs = state.opening ? Math.round(performance.now() - state.opening.startedAt) : undefined; showLoadTimes(); appendTrace(`Activity opened in ${state.loadTimes.launchMs} ms`); } } }
  catch (error) {
    // The Worker was still inside an earlier operation (a run that failed while it kept working): start over once in a fresh Worker instead of reporting "already busy".
    if (token === state.operation && !retried && error?.name === 'ProtocolError' && /processando|processing/i.test(error.message ?? '')) { finishOperation(token); state.needsRestart = true; return runAPKOnce(true); }
    if (token === state.operation) reportAPKError(error);
  }
  finally { finishOperation(token); }
}
async function reloadActivity(mode = 'recreate') {
  if (!state.runtime || state.busy || !state.apkRunning) return;
  await flushPendingInputs(); hideError(); state.stickyError = false; const token = beginOperation(mode === 'reopen' ? 'Reopening the Activity…' : 'Recreating the Activity…');
  try { const snapshot = await state.runtime.reloadActivity({ mode, onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Could not reload the Activity'); }
  finally { finishOperation(token); }
}
async function backAPK() {
  if (!state.runtime || state.busy || !state.canGoBack) return;
  await flushPendingInputs(); hideError(); state.stickyError = false; const token = beginOperation('Returning to the previous Activity…');
  try { const snapshot = await state.runtime.back({ onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Could not go back'); }
  finally { finishOperation(token); }
}
async function clickView(id) {
  if (!state.runtime) return;
  // A tap during a running operation is queued, not dropped (Android delivers it when the main thread is free); bounded so a wedged VM cannot hold it forever.
  state.pendingClicks = (state.pendingClicks ?? 0) + 1;
  try {
    for (let waited = 0; state.busy && waited < 15000; waited += 10) { await new Promise(resolve => setTimeout(resolve, 10)); if (!state.runtime) return; }
    if (state.busy) return;
    await flushPendingInputs();
    if (state.busy) { for (let waited = 0; state.busy && waited < 15000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10)); if (state.busy || !state.runtime) return; }
  } finally { state.pendingClicks--; }
  const token = beginOperation('Running DEX callback…');
  try { const snapshot = await state.runtime.click(id, { onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Callback interrupted'); }
  finally { finishOperation(token); }
}
async function runDemo() {
  if (state.noBundledApks) return;   // the published site carries no APKs: the demo is a local/test-build feature
  await importSource({ name: 'kotlin-counter.apk', url: new URL('./fixtures/kotlin-counter.apk', import.meta.url).href }, true);
}
async function inspectCatalogAPK(entry) {
  await importSource({ name: entry.file, url: new URL(`./fixtures/${encodeURIComponent(entry.file)}`, import.meta.url).href }, true);   // like a file: installed and opened (the inspection stays in the Package panel)
}
async function loadScenarioCatalog() {
  const list = $('scenario-list');
  try {
    const response = await fetch(new URL('./fixtures/catalog.json', import.meta.url), { cache: 'no-store' });
    // A build without bundled APKs (the public site: scripts/publish-site.mjs leaves them out) has no catalog: the page is only for the user's own APKs, so the library and the demo go away.
    if (response.status === 404) { state.noBundledApks = true; return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.scenarios)) throw new Error('Invalid catalog format');
    // The page starts without the library and the demo (hidden in index.html) and shows them once there is a catalog, so a page without APKs never draws them.
    $('scenario-catalog').hidden = false; document.querySelector('.demo-row')?.removeAttribute('hidden'); state.bundledApks = true; if (!state.currentSource) $('empty-preview').querySelector('p').innerHTML = emptyPreviewHint();
    if ($('catalog-count')) $('catalog-count').textContent = String(catalog.scenarios.length);
    const cards = catalog.scenarios.map((entry) => {
      // The catalog names packaged fixtures; it never supplies runtime data or behavior.
      if (!/^[a-z0-9-]+\.apk$/i.test(entry.file)) throw new Error('Invalid APK name in the catalog');
      const available = entry.available !== false;
      const card = document.createElement('article'); card.className = 'scenario-card';
      const top = document.createElement('div'); top.className = 'scenario-card-top';
      const icon = document.createElement('span'); icon.className = 'scenario-file-icon'; icon.textContent = 'APK';
      const badge = document.createElement('span'); badge.className = `scenario-badge${entry.executionValidated ? ' supported' : ''}`;
      badge.textContent = available ? entry.executionValidated ? 'Validated' : 'Experimental' : 'Building';
      top.append(icon, badge);
      const title = document.createElement('h3'); title.textContent = entry.title;
      const description = document.createElement('p'); description.textContent = entry.description;
      const tags = document.createElement('div'); tags.className = 'scenario-tags';
      (entry.tags || []).forEach((text) => { const tag = document.createElement('span'); tag.textContent = text; tags.append(tag); });
      const file = document.createElement('div'); file.className = 'scenario-filename'; file.textContent = entry.file; if (entry.sizeBytes) { const size = document.createElement('span'); size.className = 'scenario-size'; size.textContent = formatSize(entry.sizeBytes); file.append(' ', size); }
      const actions = document.createElement('div'); actions.className = 'scenario-actions';
      const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Open'; inspect.setAttribute('aria-label', `Open ${entry.title}`);
      inspect.dataset.inspectApk = entry.id; inspect.dataset.available = String(available); inspect.disabled = state.busy || !available;
      inspect.addEventListener('click', () => { if (toolDock.active === 'examples') toolDock.close(); inspectCatalogAPK(entry); });   // the list is a dock tab: it gets out of the way of the device
      const download = document.createElement('a'); download.textContent = 'Download';
      if (available) { download.href = new URL(`./fixtures/${encodeURIComponent(entry.file)}`, import.meta.url).href; download.download = entry.file; }
      else { download.setAttribute('aria-disabled', 'true'); download.title = 'This APK is still being built'; }
      actions.append(inspect, download); card.append(top, title, description, tags, file, actions); return card;
    });
    list.replaceChildren(...cards);
  } catch (error) {
    $('scenario-catalog').hidden = false;
    const message = document.createElement('p'); message.className = 'catalog-loading'; message.textContent = `Catalog unavailable: ${error.message}. Try reloading the page.`; list.replaceChildren(message);
  }
}
// The lab has a single mode (APK); switchMode('apk') resets the preview chrome to the APK's current state.
function switchMode() {
  state.mode = 'apk';
  if (!state.apkRunning) showDeviceHome(); else { $('android-device').hidden = false; $('android-device').inert = false; $('empty-preview').hidden = true; }
  hideError();
  $('execution-engine').textContent = '411 × 840 dp · DENSITY 1';
  $('preview-name').textContent = state.inventory?.packageName || 'App preview';
  const running = state.apkRunning;
  $('runtime-badge').className = `runtime-badge${running ? ' running' : ''}`;
  $('runtime-badge').innerHTML = `<span></span> ${running ? 'RUNNING' : state.inventory?.unsupportedFeatures?.length ? 'BLOCKED' : state.runtime ? 'INSPECTED' : 'INACTIVE'}`;
  if (state.lastAPKError) { showError(state.lastAPKError.error, state.lastAPKError.title); return; }
  setStatus(running ? 'Activity running · interact with the UI' : state.inventory?.unsupportedFeatures?.length ? 'APK identified · run blocked by unsupported features' : state.runtime ? 'Inspected · run attempt available' : 'Waiting for an app', running ? 'ok' : state.inventory?.unsupportedFeatures?.length ? 'error' : '');
}
$('apk-file').addEventListener('change', (event) => { chooseFile(event.target.files?.[0]); event.target.value = ''; });
$('apk-file').addEventListener('cancel', () => { state.pendingReplaceShelfId = null; });   // the picker of "Choose the APK again" closed without a file
$('error-reimport')?.addEventListener('click', () => reimportSavedApp());
$('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); $('drop-zone').classList.add('dragging'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
// The file handle of a dropped file (Chrome: DataTransferItem.getAsFileSystemHandle) must be asked for during the drop event itself; the saved app keeps it (src/apk-shelf.js).
const droppedHandle = event => { try { return [...(event.dataTransfer?.items ?? [])].find(item => item.kind === 'file')?.getAsFileSystemHandle?.() ?? null; } catch { return null; } };
$('drop-zone').addEventListener('drop', (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); state.pendingReplaceShelfId = null; chooseFile(event.dataTransfer.files?.[0], droppedHandle(event)); });
// Choosing the file: the browser's file picker with a handle where there is one (showOpenFilePicker), the plain file input otherwise.
$('drop-zone').addEventListener('click', async event => {
  state.pendingReplaceShelfId = null;   // a new APK, not "Choose the APK again"
  if (!handlePickerUsable()) return;   // the label opens the plain input
  event.preventDefault();
  const picked = await pickApkWithHandle();
  if (picked === 'cancelled') return;
  if (picked && await openPickedApk(picked)) return;
  $('apk-file').click();   // the handle picker refused to open (embedded browsers): the plain input, once
});
// The device takes an APK too: dropped on the stage it is installed like one dropped on the panel.
{ const stage = $('preview-stage'), hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
  stage.addEventListener('dragover', event => { if (!hasFiles(event)) return; event.preventDefault(); stage.classList.add('apk-dragging'); });
  stage.addEventListener('dragleave', event => { if (!stage.contains(event.relatedTarget)) stage.classList.remove('apk-dragging'); });
  stage.addEventListener('drop', event => { if (!hasFiles(event)) return; event.preventDefault(); stage.classList.remove('apk-dragging'); state.pendingReplaceShelfId = null; chooseFile(event.dataTransfer.files?.[0], droppedHandle(event)); }); }
showDeviceHome(state.homeMode ?? 'idle');   // by default the stage shows the Android device on its launcher
refreshShelf();   // the apps saved by earlier visits, on that launcher
$('error-close').addEventListener('click', dismissError);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('error-panel').hidden && !event.target?.closest?.('input,textarea,select,[contenteditable]')) { event.preventDefault(); dismissError(); } });
// Back from the keyboard (the toolbar has no Back button: the device's navigation bar and gesture are the way back): Esc while the focus is on the device screen, or Alt+←
// anywhere outside a text field, does what the navigation bar's Back does (src/task-switcher.js navigate). A key the app or a window of the page already took is left alone.
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || modalHost.count || !$('error-panel').hidden) return;
  const onScreen = !!event.target?.closest?.('#android-screen'), typing = !!event.target?.closest?.('input,textarea,select,[contenteditable]');
  const wanted = (event.key === 'Escape' && onScreen && !typing) || (event.key === 'ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !typing);
  if (!wanted || !state.runtime) return;
  event.preventDefault(); taskSwitcher?.navigate?.('back');
});
$('recreate-activity')?.addEventListener('click', () => reloadActivity('recreate'));   // the toolbar no longer has this button; lab.reloadActivity still recreates
/** "Reopen" in the toolbar: the app starts from zero, as after killing its process. The running VM's Worker is terminated (nothing it held stays in memory), the APK is opened
 *  again in a fresh Worker and the launcher Activity starts; app data on the virtual device is kept or cleared as Controls › Files and data › App data says. lab.reloadActivity / the MCP
 *  `reload` tool keep their in-VM modes (recreate, reopen). */
function reopenApp() {
  if (!state.currentSource || state.busy || state.runStarting) return;
  state.needsRestart = true; appendTrace?.('Reopen: VM terminated, the app opens again from zero in a fresh Worker');
  return runAPK();
}
$('cancel-operation').addEventListener('click', cancelOperation);
$('demo-button').addEventListener('click', runDemo);
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
  if (event.source === window.parent && window.parent !== window) {
    if (event.data.type === 'apk-lab-run-demo') runDemo();
  }
});
// The lab chrome theme is a per-viewer preference; the emulated Android screen keeps the APK's own colors.
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('apkweb-theme', theme); } catch {}
});
const catalogReady = loadScenarioCatalog();
notifyParent('apk-lab-ready');
if (params.get('demo') === '1') catalogReady.then(() => runDemo());   // after the catalog check: a site without APKs has no demo
initDevicePanel();
initCollapsibleSections($('control-panel')); initHelpTips($('control-panel'), { modalHost }); initControlPanelUI($('control-panel'));   // all sections collapsed; the "Find a control" box and each section's one-line summary (src/control-panel-ui.js); one "?" per section opens its explanations in a dialog (src/help-tips.js)
