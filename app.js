import { APKWorkerClient } from './apk-worker-client.js?v=5553a52fdbbb';
import { layoutBoundsRects, drawLayoutBounds } from './layout-bounds.js?v=5553a52fdbbb';
import { loadDeviceSettings, saveDeviceSettings, sanitizeSettings, defaultDeviceSettings, resolveDevice, deviceForVM, DEFAULT_ENGINE } from './device-settings.js?v=5553a52fdbbb';
import { initCollapsibleSections } from './panel-sections.js?v=5553a52fdbbb';
import { warmupLabel } from './warmup.js?v=5553a52fdbbb';
import { createApkShelf, indexedDbShelfBackend } from './apk-shelf.js?v=5553a52fdbbb';
import { ISO_COUNTRIES } from './iso-codes-data.js?v=5553a52fdbbb';
import { initHelpTips } from './help-tips.js?v=5553a52fdbbb';
import { createToolDock } from './tool-dock.js?v=5553a52fdbbb';
import { createPermissionsPanel } from './permissions-panel.js?v=5553a52fdbbb';
import { createSharedFilesPanel } from './shared-files-panel.js?v=5553a52fdbbb';
import { createAppDataPanel } from './app-data-panel.js?v=5553a52fdbbb';
import { createCameraLab } from './camera-lab.js?v=5553a52fdbbb';
import { createOverridesPanel } from './overrides-panel.js?v=5553a52fdbbb';
import { createIgnoredActivitiesPanel } from './ignored-activities-panel.js?v=5553a52fdbbb';
import { createHostMapPanel } from './host-map-panel.js?v=5553a52fdbbb';
import { createEndpointMocksPanel } from './endpoint-mocks-panel.js?v=5553a52fdbbb';
import { EVENT_SECONDS_STEPS } from './time-limits.js?v=5553a52fdbbb';
import { MEMORY_STEPS_MIB, memoryBudget } from './memory-budget.js?v=5553a52fdbbb';
import { CORE_MEMORY_DEFAULT, checkCoreMemory, sameCoreMemory } from './core-memory.js?v=5553a52fdbbb';
import { createDeviceView, createViewState } from './device-view.js?v=5553a52fdbbb';
import { createTaskSwitcher } from './task-switcher.js?v=5553a52fdbbb';
import { createDeviceZoom } from './device-zoom.js?v=5553a52fdbbb';
import { buildDiagnosticReport, causeOf } from './diagnostic-report.js?v=5553a52fdbbb';
import { formatApiGapReport } from './api-gap-scan.js?v=5553a52fdbbb';
import { createLogcatPanel } from './logcat-panel.js?v=5553a52fdbbb';
import { createComposeInspectorPanel, flattenViews, buildLayoutBoundsElements } from './compose-inspector-panel.js?v=5553a52fdbbb';
import { createNetlogPanel, addAllowedHost } from './netlog-panel.js?v=5553a52fdbbb';
import { createPluginHost, layoutBoundsElementOut } from './plugin-host.js?v=5553a52fdbbb';
import { captureImage } from './screen-capture.js?v=5553a52fdbbb';
import { createPluginsPanel } from './plugins-panel.js?v=5553a52fdbbb';
import { createMcpTools } from './mcp-tools.js?v=5553a52fdbbb';
import { createMcpLink, generateMcpToken, mcpServeCommand, mcpAgentSetup, MCP_AGENTS, mcpBridgePort } from './mcp-link.js?v=5553a52fdbbb';
import { createModalHost } from './lab-modal.js?v=5553a52fdbbb';
import { createCustomScreenPanel } from './custom-screen-panel.js?v=5553a52fdbbb';
import { createDeviceFullscreen } from './device-fullscreen.js?v=5553a52fdbbb';
import { createSideTabHost, createTabAction } from './lab-side-tabs.js?v=5553a52fdbbb';
import { createDragLayer } from './lab-drag.js?v=5553a52fdbbb';
import { createLabScroll } from './lab-scroll.js?v=5553a52fdbbb';
import { createHighlightLayer, createHighlightAction } from './lab-highlight.js?v=5553a52fdbbb';
import { buildDeepLinkRequest, addToHistory, historyLabel, loadHistory, saveHistory, describeDeepLink } from './deep-link-panel.js?v=5553a52fdbbb';
const apkVM = new APKWorkerClient();
// The device's home screen keeps every APK opened here (src/apk-shelf.js: this browser's IndexedDB, with the file handle where the browser gives one), one icon beside the other.
const apkShelf = (() => { try { const backend = indexedDbShelfBackend(); return backend ? createApkShelf(backend) : null; } catch { return null; } })();
async function refreshShelf() { if (!apkShelf) return; try { taskSwitcher?.setShelf(await apkShelf.list(), state.shelfId ?? null); } catch (error) { appendTrace(`Tela inicial: ${error?.message ?? error}`); } }
async function openSavedApp(id) {
  if (state.busy || !apkShelf) return;
  try {
    const got = await apkShelf.file(id); if (!got) { await refreshShelf(); return; }
    appendTrace(got.fromDisk ? `Abrindo ${got.file.name} do disco (arquivo salvo na tela inicial)` : `Abrindo a cópia salva de ${got.file.name}`);
    await importSource({ file: got.file, name: got.file.name, shelfId: id }, true);   // a tap on a launcher icon starts the app
  } catch (error) { reportAPKError(error, 'Não foi possível abrir o app salvo'); }
}
async function removeSavedApp(item) {
  if (!apkShelf || state.busy) return;
  const name = item.label || item.name;
  if (!confirm(`Remover ${name} da tela inicial?\n\nA cópia guardada neste navegador é apagada. O arquivo APK no seu disco não muda.`)) return;
  await apkShelf.remove(item.id); if (state.shelfId === item.id) state.shelfId = null; await refreshShelf(); setStatus(`${name} removido da tela inicial`);
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
/** The empty stage's hint. The published site carries no example APKs (no catalog): there the hint does not point at an Exemplos tab that is not there. */
function emptyPreviewHint() { return state.noBundledApks ? 'Selecione um APK e clique em Executar.' : 'Selecione um APK e clique em Executar.<br>Ou escolha um dos exemplos na aba Exemplos, na barra de baixo.'; }
function setStatus(message, kind = '') {
  $('status-text').textContent = message;
  $('status-dot').className = kind;
  notifyParent('apk-lab-state', { mode: state.mode, status: message, running: kind === 'ok' });
}
// "Recriar" / "Reabrir" the Activity: shown while an APK runs (an Activity is on screen), disabled while the VM is busy.
function syncReloadButton() { for (const id of ['reopen-activity']) { const button = $(id); if (!button) continue; button.hidden = state.mode !== 'apk' || !state.apkRunning || !state.runtime; button.disabled = state.busy || !state.runtime || !state.apkRunning; } }
// "Tela pronta" (src/screen-ready.js): the Activity and its fragments loaded and the screen is still; the title says what it still waits for.
function showScreenReady(ready) {
  const chip = $('screen-ready'); if (!chip) return;
  if (!ready || !state.apkRunning) { chip.hidden = true; return; }
  chip.hidden = false; chip.dataset.ready = String(!!ready.ready); chip.textContent = ready.ready ? '● pronta' : '◌ carregando';
  chip.title = ready.ready ? `Tela pronta: ${ready.activity ?? ''}${ready.fragments?.length ? ` com ${ready.fragments.length} fragment(s)` : ''}` : `Ainda carregando: ${(ready.waitingFor ?? []).join('; ')}`;
}
// "Aquecendo" (src/warmup.js): the VM is still paying for first-time work (classes, methods prepared on their first call); the title has the numbers.
function showWarmup(warmup) {
  const chip = $('vm-warmup'); if (!chip) return;
  const label = state.apkRunning ? warmupLabel(warmup) : null; if (!label) { chip.hidden = true; return; }
  chip.hidden = false; chip.dataset.ready = String(!label.warming); chip.textContent = label.text; chip.title = label.title;
}
/** The run button: "Executar APK", or "Reiniciar e executar" after a failure (it then reopens the APK in a fresh Worker before starting it). */
function syncRunButton() {
  const button = $('run-button'); if (!button) return;
  const label = state.needsRestart ? 'Reiniciar e executar' : 'Executar APK', text = [...(button.childNodes ?? [])].find(node => node.nodeType === 3);
  if (text) text.textContent = label + ' '; else button.prepend?.(label + ' ');
  button.title = state.needsRestart ? 'A última execução terminou com erro: reabre o APK numa VM nova e executa de novo' : '';
}
function setBusy(busy) {
  state.busy = busy; syncReloadButton();
  $('activity-select').disabled = busy;
  $('run-button').disabled = busy || !(state.runtime || (state.needsRestart && state.currentSource)) || !!state.inventory?.unsupportedFeatures?.length;   // after a failure that took the VM down, Reiniciar still works from the file
  $('stop-vm').hidden = !busy && !apkVM.worker;
  $('back-button').disabled = busy || !state.runtime || !state.canGoBack;
  $('demo-button').disabled = busy;
  $('apk-file').disabled = busy;
  $('reopen-file').disabled = busy;
  $('inspect-native-button').disabled = busy || !state.runtime;
  if ($('clear-app-data')) $('clear-app-data').disabled = busy || !state.runtime;
  $('native-abi').disabled = busy; $('native-library').disabled = busy;
  document.querySelectorAll('[data-inspect-apk]').forEach((button) => { button.disabled = busy || button.dataset.available === 'false'; });
  $('run-button').querySelector('kbd').textContent = busy ? '…' : 'RUN'; syncRunButton();
}
function appendTrace(message) {
  state.trace.push(message);
  if (state.trace.length > 1000) state.trace = state.trace.slice(-1000);
  $('trace-output').textContent = state.trace.join('\n');
  $('trace-count').textContent = `${state.trace.length} eventos`;
}
function updateTrace(snapshot) {
  if (!Array.isArray(snapshot.trace)) return;
  state.trace = snapshot.trace.map((item) => typeof item === 'string' ? item : JSON.stringify(item));
  $('trace-output').textContent = state.trace.join('\n') || 'Nenhum evento registrado.';
  $('trace-count').textContent = `${state.trace.length} eventos`;
}
function resetWebViews() { try { deviceView.resetWebViews?.(); } catch { /* the device view is not created yet: no WebView exists either */ } }
function hideError() { $('error-panel').hidden = true; }
/** A launch or click that passed the soft wall budget keeps running while it makes progress: say so instead of looking frozen. */
apkVM.onHeartbeat = beat => { if (beat?.soft && state.mode === 'apk') setStatus(`Ainda executando (${Math.round((beat.wallMs ?? 0) / 1000)} s) · a VM continua avançando: ${(beat.stack ?? []).slice(0, 1).join('') || 'sem pilha Java'}`); };
/** "Estado da tela" from the live Worker (null when it is gone or has nothing loaded). */
/** The page-side account of a VM that cannot answer: why (no Worker, an operation still running, a failed request), the last signal it sent, its memory at the last snapshot and the tail of the log. */
function screenStateUnavailable(reason) {
  const pending = apkVM.pending, lines = ['Estado da tela', `A VM não respondeu ao pedido de estado: ${reason}.`];
  if (!apkVM.worker) lines.push('Não há Web Worker: nenhum APK foi carregado nesta página, ou o Worker foi encerrado (erro, tempo limite ou "Encerrar"); reabra o APK.');
  else if (pending) lines.push(`A VM ainda está ocupada com a operação "${pending.type}" há ${Math.round((Date.now() - pending.startedAt) / 1000)} s; um Worker ocupado só responde entre dois eventos. Os dados abaixo são o último sinal que ele enviou.`);
  if (apkVM.worker) { try { lines.push(apkVM.describeLastSignal(pending?.type ?? 'estado').text); } catch { /* no signal yet */ } }
  const beat = apkVM.lastHeartbeat?.vm; if (beat) lines.push(`No último sinal: ${beat.objects} de ${beat.limit} objetos vivos, ${beat.collections} coletas de lixo (${beat.gcMs} ms), Activity no topo: ${beat.activity ?? 'nenhuma'}. Coletor: ${beat.gcEnabled ? 'ligado' : 'DESLIGADO'}, piso de coleta ${beat.gcFloor ?? '?'} objetos, ${beat.gcBlocked ? `bloqueado agora por "${beat.gcBlocked}"` : 'livre para coletar agora'}, execuções aninhadas ${beat.nestedRuns ?? 0}, coletas puladas ${JSON.stringify(beat.gcSkips ?? {})}.`);
  const health = state.lastVmHealth; if (health) lines.push(`Memória no último quadro: ${health.liveObjects} de ${health.limit} objetos vivos (${Math.round(100 * health.liveObjects / health.limit)}%), ${health.collections ?? 0} coletas, último evento ${health.lastEventMs ?? 0} ms${health.oomCount ? `, ${health.oomCount} OutOfMemoryError` : ''}.`);
  lines.push(`Status da página: ${$('status-text')?.textContent ?? ''}`, `Operação na tela: ${$('operation-panel')?.hidden ? 'nenhuma' : $('operation-message')?.textContent}`);
  const log = ($('trace-output')?.textContent ?? '').split('\n').filter(Boolean).slice(-25); if (log.length) lines.push('Fim do log de execução:', ...log.map(line => '  ' + line));
  return { text: lines.join('\n'), blank: false };
}
async function fetchScreenState() {
  if (!apkVM.worker) return screenStateUnavailable('sem Worker');
  try { return await apkVM.screenState(); } catch (error) { return screenStateUnavailable(error?.message ?? String(error)); }
}
document.getElementById('screen-state-copy')?.addEventListener('click', async event => {
  const button = event.currentTarget, screen = await fetchScreenState(), report = screen.text;
  try { await navigator.clipboard.writeText(report); button.textContent = screen?.blank ? 'Copiado (tela em branco)' : 'Estado da tela copiado'; }
  catch { $('trace-output').textContent = report; $('trace').open = true; getSelection()?.selectAllChildren($('trace-output')); button.textContent = 'Selecionado: copie com Cmd+C'; }
  setTimeout(() => { button.textContent = 'Copiar estado da tela'; }, 2500);
});
/** The "== Resumo ==" block of a report (at most 40 lines): what one photo of the screen must contain. */
function extractSummary(text) {
  const lines = String(text ?? '').split('\n'), start = lines.findIndex(line => line === '== Resumo =='); if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line === '== fim do resumo ==');
  // wrapped at ~70 characters with a hanging indent, never cut with an ellipsis: the overlay scrolls if the block is longer than the screen
  const wrap = line => { if (line.length <= 70) return [line]; const out = []; let rest = line, first = true; while (rest.length > 0) { const width = first ? 70 : 66; if (rest.length <= width) { out.push((first ? '' : '    ') + rest); break; } let cut = rest.lastIndexOf(' ', width); if (cut < 20) cut = width; out.push((first ? '' : '    ') + rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); first = false; } return out; };
  return lines.slice(start, end > start ? end : start + 60).flatMap(wrap).join('\n');
}
function showSummary(text) {
  const summary = extractSummary(text) ?? 'Resumo indisponível: ainda não há dados da VM (nenhum APK em execução, ou o Worker foi encerrado antes de gerar o relatório).';
  $('summary-text').textContent = summary; $('summary-overlay').hidden = false;
}
document.getElementById('summary-close')?.addEventListener('click', () => { $('summary-overlay').hidden = true; });
document.getElementById('screen-state-summary')?.addEventListener('click', async () => { const screen = await fetchScreenState(); showSummary(screen?.text); });
document.getElementById('error-summary')?.addEventListener('click', async () => { const report = state.errorReport ?? $('error-message').textContent; showSummary(extractSummary(report) ? report : (await fetchScreenState())?.text ?? report); });
document.getElementById('error-copy')?.addEventListener('click', async event => {
  const screen = await fetchScreenState();
  const button = event.currentTarget, report = (state.errorReport ?? $('error-message').textContent) + (screen ? '\n\n' + screen.text : '') + (state.apiGaps ? '\n\n' + formatApiGapReport(state.apiGaps) : '');   // the static API estimate may arrive after the error was shown
  try { await navigator.clipboard.writeText(report); button.textContent = 'Diagnóstico copiado'; }
  catch { $('error-detail').textContent = report; $('error-detail').hidden = false; $('error-diagnostics').hidden = false; $('error-diagnostics').open = true; getSelection()?.selectAllChildren($('error-detail')); button.textContent = 'Selecionado: copie com Cmd+C'; }
  setTimeout(() => { button.textContent = 'Copiar diagnóstico'; }, 2500);
});
function showError(error, title = 'Tentativa de execução interrompida') {
  const inventory = state.mode === 'apk' ? state.inventory : null;
  const raw = error?.message || String(error);
  $('error-title').textContent = /JNI|native method|native library/i.test(raw) ? 'Limite de execução nativa' : title;
  const cause = causeOf(raw);
  $('error-message').textContent = cause.length > 800 ? '…' + cause.slice(-800) : cause;
  const details = [...(inventory?.unsupportedFeatures || [])];
  if (cause !== raw || cause.length > 800) details.push('Pilha de chamadas:\n' + raw);
  if (error.details) details.push(typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2));
  if (error.trace?.length) details.push('Últimas instruções da VM:\n' + error.trace.slice(-40).join('\n'));
  $('error-detail').textContent = [...new Set(details)].join('\n');
  state.errorReport = buildDiagnosticReport({ error, packageName: inventory?.packageName ?? state.fileName ?? 'APK', tolerateMissing: $('tolerate-missing')?.value ?? 'off', methodOverrides: overridesPanel.activeCount(), ignoredActivities: ignoredPanel.activeCount(), endpointMocks: mocksPanel.activeCount(), hostRedirects: hostMapPanel.activeLines(), build: document.querySelector?.('script[src*="app.js"]')?.src?.split('v=')[1] ?? '' }).text;
  $('error-detail').hidden = !details.length;
  $('error-diagnostics').hidden = !details.length;
  $('error-diagnostics').open = false;
  $('error-panel').hidden = false;
  $('runtime-badge').className = 'runtime-badge';
  $('runtime-badge').innerHTML = '<span></span> INTERROMPIDO';
  setStatus('Tentativa interrompida · diagnóstico real da VM', 'error');
  appendTrace(`ERRO: ${raw}`);
}
function reportAPKError(error, title) {
  state.lastAPKError = { error, title }; state.needsRestart = !!state.currentSource; syncRunButton();   // after a failure the VM may be stuck or half-dead: Executar reopens the APK in a fresh Worker
  state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  $('android-content').inert = true; $('android-window-layer').inert = true;
  if (error.navigation) state.canGoBack = !!error.navigation.canGoBack;
  if (!apkVM.worker) { state.runtime = null; state.apkRunning = false; }
  $('back-button').hidden = state.mode !== 'apk' || !state.canGoBack;
  $('back-button').disabled = state.busy || !state.runtime || !state.canGoBack; syncReloadButton();
  if (state.mode === 'apk') showError(error, title);
  else appendTrace(`ERRO APK: ${error.message || error}`);
}
// Boot screen: the phone frame appears in the click's own frame (before the Worker answers), shows the phase text, and fades out when the first real frame is drawn (or the operation ends without one).
function sizeBootOverlay() {
  const stage = $('preview-stage'), overlay = $('boot-overlay'); if (!stage || !overlay) return;
  const d = resolveDevice(deviceState.settings), w = d.widthDp, h = d.heightDp, fitted = Math.min(0.7, Math.max(120, stage.clientWidth - 24) / (w + 10), Math.max(160, stage.clientHeight - 16) / (h + 10)), scale = Number.isFinite(deviceState.zoom) && deviceState.zoom > 0 ? deviceState.zoom : fitted;   // the launch screen follows the stage zoom
  overlay.style.setProperty('--boot-w', String(w)); overlay.style.setProperty('--boot-h', String(h)); overlay.style.setProperty('--boot-scale', scale.toFixed(4));
}
// The caption sits in a box of fixed height under the logo (styles.css .boot-caption): a longer or shorter status never moves the logo; the full text is the tooltip.
/** No app window on screen: the device shows its launcher. 'idle' (nothing opened yet), 'installing' (the package is being read) or 'installed' (tap the icon to start). */
function showDeviceHome(mode = state.homeMode ?? 'idle', label = '') {
  if (!taskSwitcher || !deviceView) return;
  state.homeMode = mode; const d = resolveDevice(deviceState.settings), buttons = d.navigation === 'buttons';
  if (!state.apkRunning) deviceView.renderSystemBars({ widthDp: d.widthDp, heightDp: d.heightDp, status: { height: 24, visible: true, color: 0, light: false }, nav: { mode: buttons ? 'buttons' : 'gesture', thickness: buttons ? 48 : 24, side: 'bottom', visible: true, color: 0, light: false }, contentFrame: { left: 0, top: 0, right: d.widthDp, bottom: d.heightDp } });
  $('android-device').hidden = false; $('android-device').inert = false; $('empty-preview').hidden = true;
  taskSwitcher.home(mode, { label, key: mode === 'installed' ? state.inventory : null });
}
function setBootCaption(text) { const caption = $('boot-caption'); if (!caption) return; caption.textContent = text; caption.title = text; }
function showBoot(caption) {
  const overlay = $('boot-overlay'); if (!overlay) return;
  clearTimeout(state.bootTimer); sizeBootOverlay(); setBootCaption(caption); overlay.classList.remove('fading', 'idle'); overlay.hidden = false;
  { const icon = $('boot-app-icon'), url = taskSwitcher?.icon?.() ?? null; if (icon) { icon.hidden = !url; if (url) icon.src = url; else icon.removeAttribute?.('src'); overlay.classList.toggle('has-app-icon', !!url); } }   // the app's own icon, like Android's splash screen; the Android mark only when the package has none to show
  $('empty-preview').hidden = true; state.bootVisible = true;
}
function hideBoot({ force = false } = {}) {
  const overlay = $('boot-overlay'); if (!overlay || !state.bootVisible) return;
  // An APK that is loaded but not running keeps the phone frame on screen, idle, with the one thing the user can do next; the frame only goes away when the app
  // draws its first frame (force) or when there is no APK (an error, a closed file).
  if (!force && state.currentSource && !state.apkRunning && !state.lastAPKError && state.mode === 'apk') { state.bootVisible = false; overlay.hidden = true; overlay.classList.remove('fading', 'idle'); showDeviceHome(state.runtime ? 'installed' : state.homeMode); return; }   // loaded but not running: the launcher with the app's icon
  state.bootVisible = false; overlay.classList.add('fading'); overlay.classList.remove('idle'); clearTimeout(state.bootTimer);
  state.bootTimer = setTimeout(() => { overlay.hidden = true; overlay.classList.remove('fading'); if (!state.apkRunning && state.mode === 'apk') showDeviceHome(); }, 380);
}
function beginOperation(message) {
  const token = ++state.operation;
  setBusy(true); $('operation-panel').hidden = false;
  $('operation-message').textContent = message; $('operation-progress').removeAttribute('value');
  const started = Date.now();
  clearInterval(state.operationTimer);
  state.operationTimer = setInterval(() => { $('operation-detail').textContent = `${Math.floor((Date.now() - started) / 1000)} s · execução em Web Worker · cancelar encerra a VM`; }, 1000);
  return token;
}
function finishOperation(token) {
  if (token !== state.operation) return;
  clearInterval(state.operationTimer); hideBoot(); $('operation-panel').hidden = true; state.abortController = null; setBusy(false); if (state.pendingInputs.size || state.pendingFocus.length || state.pendingComposeActions.length || state.pendingScrolls.size || state.pendingPointers.length || state.pendingScrollBys.size) flushPendingInputs();
}
/** Load timing per stage (shown under the inspection and in the execution log): the phases the Worker reports, from the first to the last. */
function notePhase(phase) {
  const times = state.loadTimes; if (!times || times.done || !phase) return;
  const now = performance.now(), last = times.phases.at(-1);
  if (last && last.phase === phase) return;
  if (last) last.ms = Math.round(now - last.at);
  times.phases.push({ phase, at: now, ms: 0 });
}
const PHASE_LABEL = { manifest: 'manifesto', dex: 'código (DEX)', framework: 'framework', 'framework-resources': 'estilos Android', resources: 'recursos', native: 'bibliotecas nativas' };
function showLoadTimes() {
  const times = state.loadTimes; if (!times) return;
  const parts = [`leitura do arquivo ${times.readMs} ms`, ...times.phases.filter(item => item.ms > 0 && PHASE_LABEL[item.phase]).map(item => `${PHASE_LABEL[item.phase]} ${item.ms} ms`)];
  if (times.launchMs !== undefined) parts.push(`abertura da Activity ${times.launchMs} ms`);
  const total = times.loadMs + (times.launchMs ?? 0);
  $('load-times').hidden = false;
  $('load-times').textContent = `${times.launchMs !== undefined ? 'Do arquivo à tela' : 'Carregado'} em ${(total / 1000).toFixed(2)} s · ${parts.join(' · ')}`;
}
function onWorkerProgress(progress = {}) {
  notePhase(progress.phase);
  const phases = { 'framework-resources': 'Carregando dados originais de estilos Android', framework: 'Carregando código AOSP compilado', manifest: 'Lendo o manifesto', dex: 'Inspecionando DEX', native: 'Inventariando bibliotecas nativas', complete: 'Inspeção concluída', launch: 'Tentando iniciar a Activity', intent: 'Abrindo o link', click: 'Executando callback DEX', back: 'Retornando à Activity anterior', resources: 'Lendo recursos e layouts XML' };
  const message = `${phases[progress.phase] || 'Processando no Worker'}${progress.filename ? ` · ${progress.filename}` : ''}`;
  $('operation-message').textContent = message; if (state.bootVisible) setBootCaption(message);
  const bar = $('operation-progress');
  if (progress.total > 0) { bar.max = progress.total; bar.value = progress.completed || 0; }
  else bar.removeAttribute('value');
  if (state.mode === 'apk') setStatus(message);
}
function cancelOperation() {
  ++state.operation; state.abortController?.abort(); apkVM.cancel(); setTimeout(() => apkVM.prewarm?.(), 0); state.apiGaps = null; pluginHost.vmChanged();   // the next APK starts in a Worker that is already warming
  state.viewSession++; resetWebViews(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear(); state.runtime = null; state.apkRunning = false; state.canGoBack = false; $('back-button').hidden = true; syncReloadButton(); state.lastAPKError = null;
  clearInterval(state.operationTimer); $('operation-panel').hidden = true;
  state.homeMode = 'idle'; showDeviceHome('idle');
  setBusy(false);
  if (state.mode === 'apk') { hideError(); setStatus('VM encerrada · reabra o APK para continuar'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> CANCELADO'; }
}
// ---- App data persistence (src/app-data-store.js): the toggle, the usage line and Clear storage.
function showAppData(info) {
  const element = $('app-data-usage'); if (!element) return;
  if (!info) { element.textContent = 'Dados do app: abra um APK para ver o uso.'; return; }
  const cap = formatSize(info.limitBytes ?? 0), used = `${formatSize(info.bytes ?? 0)} de ${cap} · ${info.files ?? 0} arquivo(s)`;
  element.textContent = info.enabled === false ? (info.reason === 'disabled' ? `Persistência desligada para esta execução · guardado: ${used}` : 'Persistência indisponível neste navegador (sem IndexedDB).')
    : info.error ? `Dados do app: erro ao gravar (${info.error}) · ${used}` : info.overLimit ? `Dados do app acima do limite: a gravação foi recusada e o último estado salvo foi mantido · ${used}` : `Dados do app guardados: ${used}${info.restoredFiles ? ` · ${info.restoredFiles} restaurado(s)` : ''}`;
}
apkVM.onAppData = showAppData;
apkVM.onApiGaps = report => { state.apiGaps = report; };
// Page plugins (docs/PLUGINS.md, src/plugin-host.js): each enabled plugin runs in its own Worker and only reads. With no plugin running nothing here does any work.
let pluginsPanel = null;
let mcpLink = null;
const modalHost = createModalHost();   // src/lab-modal.js: plugin screens (lab.modal) and "Expandir" on a plugin card
const pluginModals = new Map();   // modal id -> { modal, pluginId }
/** What a plugin may do with the lab (src/plugin-host.js ACTION_METHODS): the page's own controls, which show in Controles and in the Logcat like the user's. */
const pluginActions = {
  async reload(plugin, { mode }) {
    if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('Nenhum app rodando para recarregar.'), { code: 'no-apk' });
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
  /** lab.renderVariant (src/render-variant.js): one operation of the page like a click, so the user's input waits for it; nothing of the background instance is drawn here. */
  async renderVariant(plugin, options) {
    if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('Nenhum app rodando.'), { code: 'no-apk' });
    if (state.busy) throw Object.assign(new Error('A VM está ocupada com outra operação; tente de novo.'), { code: 'busy' });
    await flushPendingInputs(); if (state.busy) throw Object.assign(new Error('A VM está ocupada com outra operação; tente de novo.'), { code: 'busy' });
    const token = beginOperation(`Renderizando uma variante da tela em segundo plano (plugin ${plugin.name})…`);
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
    if (!entry || entry.pluginId !== plugin.id) throw Object.assign(new Error('Modal fechado ou desconhecido.'), { code: 'not-found' });
    if (args.op === 'update') { if (args.title !== undefined) entry.modal.setTitle(args.title); if (args.size !== undefined) entry.modal.setSize(args.size); if (args.html !== undefined) entry.modal.setHtml(args.html); return { id: entry.modal.id }; }
    if (args.op === 'post') { entry.modal.post(args.data); return { id: entry.modal.id }; }
    if (args.op === 'close') { entry.modal.close('code'); return { id: entry.modal.id }; }
    throw Object.assign(new Error(`op desconhecida: ${args.op}`), { code: 'bad-args' });
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
const labScrollCall = (method, args) => { if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('Nenhum app rodando: abra um APK e clique em Executar.'), { code: 'no-apk' }); return labScroll[method](args ?? {}); };
Object.assign(pluginActions, { tab: createTabAction({ tabs: sideTabs, emit: (id, event) => pluginHost.emit(id, 'tab', event) }), scrollTo: (plugin, args) => labScrollCall('scrollTo', args), scrollInfo: (plugin, args) => labScrollCall('info', args) });
const pluginHost = createPluginHost({ vm: apkVM, actions: pluginActions, getPackage: () => state.inventory?.packageName ?? null, captureImage: request => captureImage({ ...request, getHost: id => state.viewElements.get(String(id)) ?? null }), onChange: id => { pluginsPanel?.changed(id); if (!pluginHost?.get?.(id)?.worker) { for (const [modalId, entry] of pluginModals) if (entry.pluginId === id) entry.modal.close('stopped'); sideTabs.closeOwner(id, 'stopped'); labHighlights.closeOwner(id); } }, onLogStreaming: () => { syncLogcatStreaming().catch(() => {}); } });
window.apkLabPlugins = pluginHost;   // test and console access: .list(), .stats
// The Worker streams Logcat lines while the Logcat panel is open or a running plugin listens to 'log'; opening the panel always asks again (it shows the ring's recent lines).
let logcatPanelOpen = false, logcatStreamingSent = false;
function syncLogcatStreaming(force = false) {
  const wanted = logcatPanelOpen || pluginHost.wantsLogs || !!mcpLink?.connected; if (!force && wanted === logcatStreamingSent) return Promise.resolve();
  logcatStreamingSent = wanted; return apkVM.setLogcatStreaming(wanted);
}
const logcatPanel = createLogcatPanel({ root: $('logcat'), getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app', setStreaming: open => { logcatPanelOpen = !!open; return syncLogcatStreaming(!!open); } });   // src/logcat-panel.js; closed, the Worker keeps the lines in its ring and posts only a counter
const composeInspector = createComposeInspectorPanel({ root: $('compose-inspector'), inspect: () => apkVM.inspectCompose(), getSnapshot: () => state.apkRunning ? state.lastSnapshot : null, getHost: id => state.viewElements.get(String(id)) ?? null, getScreen: () => $('android-screen') });   // src/compose-inspector-panel.js: nothing runs while it is closed
window.apkLabComposeInspector = composeInspector;   // test and console access: .state
apkVM.onLogcat = message => { logcatPanel.push(message); pluginHost.logcat(message); };
const netlogPanel = createNetlogPanel({ root: $('netlog'), getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app', getAllowedHosts: () => deviceState.settings.network.allowedHosts,
  allowHost: host => { if ($('dev-hosts-all').checked) return; $('dev-hosts').value = addAllowedHost($('dev-hosts').value, host); $('dev-hosts').dispatchEvent(new Event('input')); },
  // right click on a request: a mock of it (the dialog opens filled; nothing is saved until Salvar) or a host redirect rule with that origin
  createMock: entry => {
    const skip = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'date', 'set-cookie', 'vary', 'age', 'server', 'alt-svc', 'strict-transport-security']);
    let url = entry.url; try { const parsed = new URL(entry.url); url = `${parsed.origin}${parsed.pathname}`; } catch { /* kept as is */ }
    const headers = (entry.responseHeaders ?? []).filter(([name]) => !skip.has(String(name).toLowerCase())).map(([name, value]) => ({ name, value }));
    mocksPanel.openPrefilled({ name: `${entry.method} ${entry.host}${entry.path?.split('?')[0] ?? ''}${entry.responseBodyTruncated ? ' (corpo cortado em 48 KB)' : ''}`.slice(0, 120), method: entry.method,
      url, status: entry.status ?? 200, reason: entry.reason ?? '', headers: headers.length ? headers : [{ name: 'Content-Type', value: entry.contentType ?? 'application/json' }], body: entry.responseBody ?? '' });
  },
  redirectHost: entry => {
    for (const id of ['control-panel', 'cp-sec-hostmap']) { const section = $(id); if (section) section.open = true; }   // the Controles card and the section, so the destination field can take the focus
    hostMapPanel.addRule(`${entry.scheme ? entry.scheme + '://' : ''}${entry.host}${entry.port && ![80, 443].includes(Number(entry.port)) ? ':' + entry.port : ''}`);
  } });   // src/netlog-panel.js; "Permitir" types the host into the Dispositivo field, the same path as typing it
apkVM.onNetlog = message => { netlogPanel.push(message); pluginHost.netlog(message); };
window.apkLabNetlog = netlogPanel;   // test and console access: .store.entries
window.apkLabLogcat = logcatPanel;   // test and console access: .store.entries
try { if (localStorage.getItem('apkweb.keepAppData') === '0') $('keep-app-data').checked = false; } catch { /* storage may be blocked */ }
$('keep-app-data')?.addEventListener('change', () => { try { localStorage.setItem('apkweb.keepAppData', $('keep-app-data').checked ? '1' : '0'); } catch { /* ignore */ } setStatus($('keep-app-data').checked ? 'Os dados do app serão mantidos a partir da próxima abertura do APK.' : 'Os dados do app não serão lidos nem gravados a partir da próxima abertura do APK.'); });
$('clear-app-data')?.addEventListener('click', async () => {
  if (state.busy || !state.runtime) return;
  if (!confirm('Apagar todos os dados guardados deste app (preferências, bancos e arquivos)? O app será reiniciado.')) return;
  try { const info = await apkVM.clearAppData(); showAppData(info); appendTrace('Dados do app apagados (como Configurações > Apps > Limpar armazenamento).'); if (state.currentSource) await importSource(state.currentSource); setStatus('Dados do app apagados · abra o app de novo para iniciar do zero'); }
  catch (error) { reportAPKError(error, 'Não foi possível limpar os dados do app'); }
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
  recorderSawWorker = true;   // the VM ended in a way the page knows about (Encerrar, an error, a timeout): not a crash
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
  const seconds = Math.round((last.at - last.startedAt) / 1000), lines = ['Última execução interrompida sem aviso', `Pacote: ${last.package ?? '?'} · modo ${last.mode ?? '?'} · rodou cerca de ${seconds} s antes do último registro (${new Date(last.at).toLocaleString()}).`,
    last.pageHeapMiB != null ? `Heap JS da página no último registro: ${last.pageHeapMiB} MiB de ${last.pageHeapLimitMiB} MiB (só o Chrome informa; o Worker da VM não entra nessa conta).` : 'Heap JS da página: indisponível neste navegador.',
    last.deviceMemoryGiB != null ? `Memória do dispositivo informada pelo navegador: ${last.deviceMemoryGiB} GiB.` : '',
    last.vm ? `VM: ${last.vm.objects} de ${last.vm.limit} objetos vivos, ${last.vm.collections} coletas (${last.vm.gcMs} ms), último evento ${last.vm.lastEventMs} ms${last.vm.oom ? `, ${last.vm.oom} OutOfMemoryError` : ''}.` : '',
    last.beat ? `Último sinal da VM (há ${Math.round(last.beat.ageMs / 1000)} s do registro): ${last.beat.operation ?? 'sem operação'}, thread ${last.beat.thread ?? '?'}, ${last.beat.stack.join(' < ') || 'sem pilha'}, chamada do host: ${last.beat.hostCall ?? 'nenhuma'}, ${last.beat.events} eventos, ${last.beat.instructions} instruções, fila ${last.beat.queueDepth}.` : '',
    `Status da página: ${last.status}`, 'Possíveis causas: o navegador encerrou a aba por falta de memória (o mais comum), a aba foi recarregada à força ou o computador dormiu. Nada disso gera erro dentro da página.', last.screen ? `\n${last.screen}` : ''].filter(Boolean);
  const banner = document.createElement('div'); banner.className = 'crash-notice'; banner.setAttribute('role', 'alert');
  const text = document.createElement('span'); text.textContent = 'A última execução parou sem aviso (provável falta de memória do navegador).';
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copiar o último estado';
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(lines.join('\n')); copy.textContent = 'Copiado'; } catch { $('trace-output').textContent = lines.join('\n'); $('trace').open = true; copy.textContent = 'Veja o log de execução'; } });
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Dispensar'; close.addEventListener('click', () => { lastRunStore.clear(); banner.remove(); });
  banner.append(text, copy, close); document.body.prepend(banner);
}
showPreviousCrash();
function formatSize(size) {
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(2)} MB`;
}
function listSection(title, items) {
  const section = document.createElement('section');
  const heading = document.createElement('h4'); heading.textContent = title; section.append(heading);
  if (!items?.length) { const line = document.createElement('p'); line.textContent = 'Nenhum item encontrado.'; section.append(line); return section; }
  const list = document.createElement('ul');
  items.slice(0, 200).forEach((item) => { const li = document.createElement('li'); li.textContent = typeof item === 'string' ? item : item.name || JSON.stringify(item); list.append(li); });
  section.append(list); if (items.length > 200) { const note = document.createElement('p'); note.textContent = `${items.length} itens no inventário; exibindo os primeiros 200.`; section.append(note); } return section;
}
function showInventory(inventory) {
  $('inventory-empty').hidden = true; $('inventory').hidden = false;
  $('package-name').textContent = inventory.packageName || 'Pacote não identificado';
  $('class-count').textContent = Array.isArray(inventory.classes) ? inventory.classes.length : inventory.classes ?? '—';
  $('class-count').title = inventory.classes == null ? 'Classes DEX não inspecionadas' : 'Classes presentes no DEX';
  $('activity-count').textContent = inventory.activities?.length || 0;
  $('dependency-count').textContent = inventory.dependencies?.length || 0;
  $('inspection-badge').textContent = inventory.inspectionComplete === false ? 'Inspeção parcial' : inventory.compose ? 'Compose APK' : 'Analisado';
  const unsupported = inventory.unsupportedFeatures || [];
  $('unsupported-notice').hidden = !unsupported.length;
  $('unsupported-list').replaceChildren(...unsupported.map((item) => { const li = document.createElement('li'); li.textContent = item; return li; }));
  const archiveSummary = $('archive-summary'); archiveSummary.replaceChildren();
  const dexSummary = document.createElement('strong'); dexSummary.textContent = `${inventory.dexFiles?.length || 0} DEX · ${inventory.inspectionComplete === false ? 'contagem parcial' : 'contagem completa de classes'}`;
  archiveSummary.append(dexSummary);
  const nativeCount = inventory.nativeLibraries?.length || 0;
  const nativeSummary = document.createElement('p'); nativeSummary.textContent = `${nativeCount} bibliotecas empacotadas; suporte JNI será verificado no uso.`; archiveSummary.append(nativeSummary); archiveSummary.hidden = false;
  const select = $('activity-select'); select.replaceChildren();
  (inventory.activities || []).forEach((activity) => {
    const name = typeof activity === 'string' ? activity : activity.name;
    const option = document.createElement('option'); option.value = name; option.textContent = `${name}${activity.launcher ? ' · launcher' : ''}`;
    option.selected = name === inventory.launcherActivity; select.append(option);
  });
  if (!select.options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Seleção automática'; select.append(option); }
  const details = $('inventory-details'); details.replaceChildren();
  if (inventory.classNames?.length || Array.isArray(inventory.classes)) { const names = inventory.classNames || inventory.classes; details.append(listSection(`CLASSES DEX · ${Math.min(120, names.length)} NOMES EXIBIDOS DE ${inventory.classes ?? names.length} · ${Math.max(0, names.length - 120)} NOMES ADICIONAIS NO INVENTÁRIO`, names.slice(0, 120))); }
  if (inventory.dexSummaries?.length) details.append(listSection('INVENTÁRIO POR DEX', inventory.dexSummaries.map((dex) => `${dex.filename}: ${dex.classes ?? '—'} classes · ${dex.methods ?? '—'} métodos · ${formatSize(dex.bytes || 0)}`)));
  if (inventory.nativeLibraryDetails?.length) {
    const groups = new Map();
    for (const lib of inventory.nativeLibraryDetails) { const abi = lib.abi || 'ABI desconhecida'; if (!groups.has(abi)) groups.set(abi, []); groups.get(abi).push(`${lib.basename || lib.path} (${formatSize(lib.bytes || 0)})`); }
    for (const [abi, libraries] of groups) details.append(listSection(`NATIVAS · ${abi} · ${libraries.length} ARQUIVOS`, libraries));
  }
  details.append(listSection('ARQUIVOS DEX', inventory.dexFiles));
  details.append(listSection('DEPENDÊNCIAS REFERENCIADAS', inventory.dependencies));
  if (inventory.applicationName) details.append(listSection('APPLICATION', [inventory.applicationName]));
  const components = ['activities', 'services', 'providers', 'receivers'].map((key) => `${key}: ${inventory[key]?.length || 0}`); details.append(listSection('COMPONENTES DO MANIFESTO', components));
  if (inventory.embeddedFrameworks?.length) details.append(listSection('FRAMEWORKS EMPACOTADOS', inventory.embeddedFrameworks));
  if (inventory.bundles?.length) details.append(listSection('BUNDLES', inventory.bundles.map((bundle) => `${bundle.path}: ${bundle.format}${bundle.bytecodeVersion ? ` v${bundle.bytecodeVersion}` : ''} · ${formatSize(bundle.bytes)} · não executado`)));
  if (inventory.framework?.enabled) details.append(listSection('FRAMEWORK AOSP · CÓDIGO DEX SEPARADO', [`${inventory.framework.classes} classes · ${inventory.framework.bytes} bytes`, `Origem: ${inventory.framework.source} · ${inventory.framework.policy}`, `SHA-256: ${inventory.framework.sha256 || 'indisponível'}`]));
  if (inventory.framework?.profiles?.length) details.append(listSection('PERFIS ORIGINAIS CARREGADOS', inventory.framework.profiles.map(profile => `${profile.profile || profile.name || 'AOSP'} · ${profile.classes ?? profile.classCount ?? '—'} classes · ${profile.reason || 'seleção explícita'} · SHA-256 ${profile.sha256 || 'indisponível'}`)));
  if (inventory.frameworkResources?.enabled) details.append(listSection('DADOS DE RECURSOS FRAMEWORK', [`${inventory.frameworkResources.selectedUniqueResourceIds} IDs originais · perfil parcial sem qualificadores`, inventory.frameworkResources.source || '', `Integridade: ${inventory.frameworkResources.integrity}`]));
  if (inventory.resourceSummary) details.append(listSection('RECURSOS ANDROID', [`${inventory.resourceSummary.entries} recursos · ${inventory.resourceSummary.parsedLayouts}/${inventory.resourceSummary.layoutFiles} layouts XML preparados${inventory.resourceSummary.xml?.deferred || inventory.resourceSummary.deferredLayouts ? ` · ${(inventory.resourceSummary.xml?.deferred || 0)} XML sob demanda` : ''}`, ...(inventory.resourceSummary.errors || [])]));
  configureNativeInspection(inventory);
  if (inventory.unsupportedFeatures?.length) details.append(listSection('LIMITAÇÕES ENCONTRADAS', inventory.unsupportedFeatures));
  if (inventory.warnings?.length) details.append(listSection('OBSERVAÇÕES', inventory.warnings));
}
function configureNativeInspection(inventory) {
  const libraries = inventory.nativeLibraryDetails || [];
  $('native-inspection').hidden = !libraries.length;
  const abiSelect = $('native-abi'); const selected = abiSelect.value; abiSelect.replaceChildren();
  [...new Set(libraries.map((lib) => lib.abi))].sort().forEach((abi) => { const option = document.createElement('option'); option.value = abi; option.textContent = `${abi} · ${libraries.filter((lib) => lib.abi === abi).length} arquivos`; abiSelect.append(option); });
  if ([...abiSelect.options].some((option) => option.value === selected)) abiSelect.value = selected;
  populateNativeLibraries();
}
function populateNativeLibraries() {
  const select = $('native-library'); select.replaceChildren();
  (state.inventory?.nativeLibraryDetails || []).filter((lib) => lib.abi === $('native-abi').value).forEach((library) => { const option = document.createElement('option'); option.value = library.path; option.textContent = `${library.basename} · ${formatSize(library.bytes)}`; select.append(option); });
}
async function inspectSelectedNative() {
  if (!state.runtime || state.busy || !$('native-library').value) return;
  const path = $('native-library').value;
  const token = beginOperation('Analisando ELF no Worker…'); $('native-result').hidden = true;
  try {
    const response = await state.runtime.inspectNative([path], { maxFiles: 1, maxBytes: 32 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 }, { onProgress: onWorkerProgress });
    if (token !== state.operation) return;
    const library = response.libraries[0];
    const target = state.inventory.nativeLibraryDetails.find((entry) => entry.path === path); if (target) Object.assign(target, library);
    state.inventory.nativeInspection = response.nativeInspection;
    const elf = library.elf;
    $('native-result').textContent = elf ? JSON.stringify({ path, inspection: library.elfInspection, format: elf.format, bits: elf.bits, architecture: elf.architecture, soname: elf.soname, needed: elf.needed, jniOnLoad: elf.jniOnLoad, jniExports: elf.jniExports.slice(0, 80), jniExportsTotal: elf.jniExports.length, symbolInspectionComplete: elf.symbolInspectionComplete, warnings: elf.warnings, executed: false }, null, 2) : JSON.stringify({ path, inspection: library.elfInspection, error: library.elfError || 'Análise omitida: arquivo acima do limite de 32 MiB.' }, null, 2);
    $('native-result').hidden = false;
    if (state.mode === 'apk') setStatus('Metadados ELF inspecionados · nenhuma biblioteca nativa foi executada');
    appendTrace(`ELF ${path}: ${library.elfInspection}`);
  } catch (error) { if (token === state.operation) reportAPKError(error, 'Não foi possível inspecionar o ELF'); }
  finally { finishOperation(token); }
}
async function importSource(source, autoRun = false) {
  if (state.busy) return;
  state.currentSource = source; state.launchAttempted = false; state.lastAPKError = null; state.stickyError = false; state.needsRestart = false; state.viewSession++; resetWebViews(); for (const id of ['android-content', 'android-window-layer', 'android-action-mode-layer']) for (const child of [...($(id)?.children || [])]) child.remove(); state.viewElements.clear(); state.shadowElements.clear(); state.windowSurfaceElements.clear(); $('android-window-layer')?.replaceChildren?.(); state.composeElements.clear(); state.nativeOverlayElements.clear(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  permissionsPanel?.detach(); filesPanel?.detach(); appDataPanel?.reset(); cameraLab?.detach(); overridesPanel?.detach(); ignoredPanel?.detach(); mocksPanel?.detach(); hostMapPanel?.resetHits(); pluginHost.vmChanged();
  // A new run (another APK, or Executar APK again) starts clean: the Worker of the previous run is terminated by apkVM.load, and what the page still shows of it goes too
  // (Logcat, network requests, memory meter, error report, last frame and heartbeat). App data follows the "Manter dados do app" option; the panel settings are kept.
  logcatPanel.reset(); netlogPanel.reset(); composeInspector.reset(); state.oomSeen = 0; state.lastVmHealth = null; state.lastSnapshot = null; state.errorReport = null; apkVM.lastHeartbeat = null; apkVM.lastScreenSnapshot = null; if ($('memory-meter')) $('memory-meter').hidden = true;
  taskSwitcher?.reset(); switchMode('apk'); hideError(); state.runtime = null; state.inventory = null; state.apkRunning = false; state.canGoBack = false; $('back-button').hidden = true;
  $('empty-preview').querySelector('h2').textContent = 'Seu aplicativo começa aqui.'; $('empty-preview').querySelector('p').innerHTML = emptyPreviewHint();
  const token = beginOperation('Lendo o arquivo APK…');
  $('native-inspection').hidden = true; $('native-result').hidden = true; $('unsupported-notice').hidden = true; $('inventory').hidden = true; $('inventory-empty').hidden = false; $('inspection-badge').textContent = 'Analisando';
  $('file-info').hidden = false; $('file-name').textContent = source.name; $('file-size').textContent = source.file ? `${formatSize(source.file.size)} · arquivo local` : 'APK de teste hospedado localmente';
  $('reopen-file').hidden = false; $('preview-name').textContent = source.name;
  state.shelfId = source.shelfId ?? null; await refreshShelf();
  showDeviceHome('installing', source.name);   // the app shows up on the launcher at once, under a spinner, while the package is read
  state.trace = []; appendTrace(`Abrindo ${source.name} em Web Worker isolado. Sem upload.`);
  setStatus('Lendo o arquivo APK…');
  try {
    let buffer; state.loadTimes = { startedAt: performance.now(), phases: [], readMs: 0, loadMs: 0 };
    $('load-times').hidden = true;
    if (source.file) buffer = await source.file.arrayBuffer();
    else {
      state.abortController = new AbortController();
      const response = await fetch(source.url, { cache: 'no-store', signal: state.abortController.signal });
      if (!response.ok) throw new Error(`Não foi possível carregar o APK (HTTP ${response.status}).`);
      if (Number(response.headers.get('Content-Length')) > 1024 * 1024 * 1024) throw new Error('O APK excede o limite de 1 GiB.');
      buffer = await response.arrayBuffer();
    }
    if (token !== state.operation) return;
    if (buffer.byteLength > 1024 * 1024 * 1024) throw new Error('O APK excede o limite de 1 GiB.');
    $('file-size').textContent = `${formatSize(buffer.byteLength)} · processado no navegador`; state.loadTimes.readMs = Math.round(performance.now() - state.loadTimes.startedAt); state.loadTimes.loadStartedAt = performance.now();
    state.apiGaps = null;
    const result = await apkVM.load(buffer, { onProgress: onWorkerProgress, device: deviceForVM(deviceState.settings), tolerateMissing: $('tolerate-missing')?.value ?? 'off', strictCrash: $('strict-crash')?.checked === true, keepData: $('keep-app-data')?.checked !== false, memoryMiB: deviceState.settings.memoryMiB, eventSeconds: deviceState.settings.eventSeconds, motionRaster: params.get('raster') !== 'full', rasterScale: deviceState.settings.raster?.motionScale ?? 1, rasterNavigation: deviceState.settings.raster?.navigation === true, rasterSettled: deviceState.settings.raster?.stillScale ?? 1, logcatStreaming: logcatPanel.streaming, renderer: deviceState.settings.renderer ?? 'cpu', engine: engineForLoad(), coreMemory: deviceState.settings.coreMemory }); state.loadedEngine = engineForLoad(); showRendererStatus(result.renderer); state.loadedMemoryMiB = deviceState.settings.memoryMiB; state.loadedCoreMemory = { ...deviceState.settings.coreMemory }; updateVmMemoryHint(); // Ownership transfers to the Worker.
    if (token !== state.operation) return;
    state.runtime = apkVM; state.inventory = result.inventory; showAppData(result.appData);
    { const times = state.loadTimes, last = times.phases.at(-1); if (last && !last.ms) last.ms = Math.round(performance.now() - last.at); times.loadMs = Math.round(performance.now() - times.startedAt); times.done = true; times.prepared = !!result.inventory.prepared;
      showLoadTimes(); appendTrace(`Carregado em ${times.loadMs} ms: ${times.phases.filter(item => item.ms > 0).map(item => `${item.phase} ${item.ms} ms`).join(', ')}`); }
    await permissionsPanel.attach(result.inventory); await filesPanel.attach(); cameraLab.attach(); await overridesPanel.attach(result.inventory); await ignoredPanel.attach(result.inventory); await mocksPanel.attach(result.inventory); pluginHost.vmChanged(); if (logcatPanelOpen || pluginHost.wantsLogs) syncLogcatStreaming(true).catch(() => {});   // before any app code runs: permission state, simulated location, method return overrides, ignored Activities, endpoint mocks
    showInventory(result.inventory); showDeviceHome('installed');
    if (source.file && apkShelf) {   // an APK from a file is kept on the home screen (one entry per package: a new build replaces the old one); a hosted example is not
      try { const saved = await apkShelf.save({ name: source.name, packageName: result.inventory.packageName || null, blob: source.file, handle: source.handle ?? null, previousId: source.shelfId ?? null }); state.shelfId = saved.id; source.shelfId = saved.id; navigator.storage?.persist?.().catch(() => {}); }
      catch (error) { appendTrace(`Tela inicial: não foi possível guardar o APK (${error?.message ?? error})`); }
      await refreshShelf();
    }
    appendTrace(`Pacote: ${result.inventory.packageName || '(não identificado)'}`);
    if (state.mode === 'apk') {
      setStatus(result.inventory.unsupportedFeatures?.length ? 'Arquivo inspecionado · veja os limites de arquivo' : 'Inspecionado · tentativa de execução disponível', result.inventory.unsupportedFeatures?.length ? 'error' : '');
      $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = `<span></span> ${result.inventory.unsupportedFeatures?.length ? 'LIMITE DE ARQUIVO' : 'INSPECIONADO'}`;
    }
  } catch (error) {
    if (token !== state.operation) return;
    $('inspection-badge').textContent = 'Erro'; state.homeMode = 'idle'; showDeviceHome('idle'); reportAPKError(error, 'Não foi possível inspecionar o APK');
  } finally { finishOperation(token); }
  if (token === state.operation && autoRun && state.runtime && !state.inventory?.unsupportedFeatures?.length) await runAPK();
}
async function chooseFile(file, handle = null) {   // handle: a FileSystemFileHandle (or a promise of one) where the browser gives it, kept with the saved app
  if (!file || state.busy) return;
  if (file.size > 1024 * 1024 * 1024) { switchMode('apk'); showError(new Error('O limite deste laboratório é 1 GiB por APK. Escolha um arquivo menor para continuar.'), 'APK acima do limite de tamanho'); return; }
  if (!/\.apk$/i.test(file.name)) { switchMode('apk'); showError(new Error('Escolha um arquivo .apk.'), 'Formato de arquivo inválido'); return; }
  let fileHandle = null; try { fileHandle = await handle; if (fileHandle?.kind !== 'file') fileHandle = null; } catch { fileHandle = null; }
  await importSource({ file, name: file.name, handle: fileHandle });
}
// Memory readout in the status bar: live VM objects against the object budget (the OutOfMemoryError threshold), an estimate of what they cost (bytesPerObject, sent by the Worker, is the measured
// all-in cost used to derive the budget, src/memory-budget.js) and, where the browser exposes it (Chrome), the JS heap of this page; the Worker's own heap is not part of that number.
const MIB = 1048576, mib = bytes => `${(bytes / MIB).toFixed(bytes < 10 * MIB ? 1 : 0)} MiB`, count = value => value >= 10000 ? `${Math.round(value / 1000)} mil` : String(value);
function updateMemoryMeter(health) {
  const meter = $('memory-meter'); if (!meter || !health || !Number.isFinite(health.liveObjects) || !health.limit) return;
  const ratio = Math.min(1, health.liveObjects / health.limit), page = globalThis.performance?.memory?.usedJSHeapSize, bytesPerObject = health.bytesPerObject || 1600, estimate = health.liveObjects * bytesPerObject;
  meter.hidden = false; meter.dataset.level = ratio >= 0.9 ? 'high' : ratio >= 0.7 ? 'warn' : 'ok'; meter.style.setProperty('--fill', `${Math.round(ratio * 100)}%`);
  const pct = ratio < 0.1 ? (ratio * 100).toFixed(1) : String(Math.round(ratio * 100)), workerBytes = health.workerHeapBytes, browser = `Memória do browser: Worker ${Number.isFinite(workerBytes) ? mib(workerBytes) : 'indisponível'} · página ${page ? mib(page) : 'indisponível'}`;
  const lines = meter.lastElementChild.children; if (lines.length !== 2) meter.lastElementChild.replaceChildren(document.createElement('span'), document.createElement('span'));
  meter.lastElementChild.children[0].textContent = `Heap Java: ${count(health.liveObjects)} objetos (${pct} % do limite) · ~${mib(estimate)} estimados`; meter.lastElementChild.children[1].textContent = browser;
  meter.title = ['O heap Java conta só os objetos da VM; o browser gasta além disso com as tabelas DEX, o CanvasKit, os rasters e cada objeto Java como objeto JavaScript.', `Objetos vivos da VM: ${health.liveObjects} de ${health.limit} (acima disso a VM lança java.lang.OutOfMemoryError).`, `Custo estimado: ${bytesPerObject} bytes por objeto (medido em exemplos reais), ≈ ${mib(estimate)}.`,
    page ? `Heap JS da página (sem o Web Worker): ${mib(page)}.` : 'Heap JS da página: indisponível neste navegador.', `Coletas de lixo: ${health.collections ?? 0} (${health.freedObjects ?? 0} objetos liberados, ${health.gcMs ?? 0} ms); último evento ${health.lastEventMs ?? 0} ms.`, health.oomCount ? `OutOfMemoryError já lançado ${health.oomCount} vez(es).` : ''].filter(Boolean).join('\n');
}
// "Mostrar limites de layout": page overlay over the device screen, redrawn only when a snapshot is drawn or the option changes.
function redrawLayoutBounds() {
  labHighlights.refresh();   // a plugin's highlights follow their components (nothing to do without highlights)
  const canvas = $('layout-bounds-canvas'); if (!canvas) return;
  const on = !!deviceState.settings.layoutBounds && !!state.lastSnapshot; canvas.hidden = !on; if (!on) return;
  const screen = $('android-screen'), frame = deviceState.bars?.contentFrame, width = screen.clientWidth || deviceState.bars?.widthDp || 411, height = screen.clientHeight || deviceState.bars?.heightDp || 914;
  drawLayoutBounds(canvas, layoutBoundsRects(state.lastSnapshot, { origin: { x: frame?.left ?? 0, y: frame?.top ?? 0 } }), width, height);
}
const deviceState = { settings: loadDeviceSettings(), clockTimer: null };
const permissionsPanel = createPermissionsPanel({ $, vm: apkVM, location: { get: () => deviceState.settings.location, set: block => { deviceState.settings = { ...deviceState.settings, location: block }; saveDeviceSettings(deviceState.settings); } } });
const filesPanel = createSharedFilesPanel({ $, vm: apkVM });   // "Arquivos do dispositivo": the shared storage the file pickers and MediaStore read (src/shared-files-panel.js)
// "Dados do app": the app's SharedPreferences and SQLite databases, viewed and edited in modals (src/app-data-panel.js, src/app-storage.js); read when the section is opened and after a run
const appDataPanel = createAppDataPanel({ $, vm: apkVM, modals: modalHost, ready: () => state.runtime === apkVM && state.launchAttempted && !state.busy, render: snapshot => renderSnapshot(snapshot) });
$('cp-sec-appdata')?.addEventListener('toggle', () => { if ($('cp-sec-appdata').open) appDataPanel.refresh(); });
const cameraLab = createCameraLab({ $, vm: apkVM });   // the device's cameras: source, frames for the VM, the camera screen of the capture Intents
const overridesPanel = createOverridesPanel({ $, vm: apkVM });
const ignoredPanel = createIgnoredActivitiesPanel({ $, vm: apkVM });
pluginsPanel = createPluginsPanel({ $, host: pluginHost, modals: modalHost, toolbarRoot: $('plugin-toolbar') });   // toolbarRoot: lab.button({ placement: 'toolbar' }) in the preview bar
// "MCP" (src/mcp-link.js, src/mcp-tools.js, scripts/lab-mcp.mjs): an MCP client on this machine uses this page through the local bridge; off until Conectar
const MCP_KEY = 'apkweb-mcp-v1';
const mcpCaller = { id: 'mcp', name: 'MCP' };
/** Input for the MCP client through the page's own input paths (src/device-view.js): a tap on Compose content is a real touch (MotionEvents through the window), a View
 * is clicked like a mouse click on it, text goes in through the keyboard path (Compose: the field is focused, then select-all and one commitText per character on its
 * InputConnection, like Android's soft keyboard; SetText only when the field has no InputConnection) or the field's input (View), scrolling by the ScrollBy action (Compose) or the View's scroll. */
const mcpInput = {
  async target(args) {
    if (!state.runtime || !state.apkRunning) throw Object.assign(new Error('Nenhum app rodando: abra um APK e clique em Executar.'), { code: 'no-apk' });
    const elements = await pluginHost.query('layoutBounds', { names: false }), wanted = args.text ? String(args.text).toLowerCase() : null;
    const textOf = element => [...(element.texts ?? []), element.editableText ?? '', ...(element.contentDescriptions ?? [])].join(' ').toLowerCase();
    let element = null;
    if (args.element_key) element = elements.find(item => item.key === String(args.element_key)) ?? null;
    else if (args.test_tag || wanted) {
      const matches = elements.filter(item => (!args.test_tag || item.testTag === String(args.test_tag)) && (!wanted || textOf(item).includes(wanted)));
      element = matches.find(item => item.actions?.includes('OnClick')) ?? matches[0] ?? null;   // the clickable one first (a Button and its inner Text share the text)
    }
    if ((args.element_key || args.test_tag || wanted) && !element) throw Object.assign(new Error(`Nenhum componente na tela com ${args.element_key ? `a chave ${args.element_key}` : [args.test_tag ? `testTag "${args.test_tag}"` : '', wanted ? `texto "${args.text}"` : ''].filter(Boolean).join(' e ')} (veja layout_bounds).`), { code: 'not-found' });
    const point = element?.bounds ? { x: (element.bounds.left + element.bounds.right) / 2, y: (element.bounds.top + element.bounds.bottom) / 2 } : Number.isFinite(args.x) && Number.isFinite(args.y) ? { x: args.x, y: args.y } : null;
    return { element, point, elements };
  },
  views() { return flattenViews(state.lastSnapshot).filter(view => view.visible && view.bounds); },
  ownerAt(point) { return this.views().filter(view => view.compose && point.x >= view.bounds.left && point.x < view.bounds.right && point.y >= view.bounds.top && point.y < view.bounds.bottom).at(-1) ?? null; },
  async tap(args) {
    const { element, point } = await this.target(args); if (!point) throw Object.assign(new Error('Diga onde tocar: test_tag, text, element_key ou x e y.'), { code: 'bad-args' });
    const owner = element?.kind === 'view' ? null : this.ownerAt(point);
    if (owner) {   // a real touch: DOWN and UP at the point, in the Compose owner's coordinates (as the page's pointer handler sends them)
      const x = point.x - owner.bounds.left, y = point.y - owner.bounds.top, t = performance.now();
      state.pendingPointers.push({ ownerViewId: owner.id, action: 0, x, y, t }, { ownerViewId: owner.id, action: 1, x, y, t: t + 60 }); await flushPendingInputs();
      return { via: 'toque', element: element?.name ?? null, x: Math.round(point.x), y: Math.round(point.y) };
    }
    const view = element?.kind === 'view' ? { id: element.id } : this.views().filter(item => item.clickable && point.x >= item.bounds.left && point.x < item.bounds.right && point.y >= item.bounds.top && point.y < item.bounds.bottom).sort((a, b) => b.depth - a.depth)[0];
    if (!view) throw Object.assign(new Error('Nada clicável nesse ponto.'), { code: 'not-found' });
    await clickView(view.id); return { via: 'clique na View', element: element?.name ?? null, id: view.id };
  },
  async type(args) {
    const { element } = await this.target(args); if (!element) throw Object.assign(new Error('Diga em qual campo escrever: test_tag, text ou element_key.'), { code: 'bad-args' });
    const text = String(args.value ?? '');
    if (element.kind === 'compose') {
      if (!element.actions?.includes('SetText')) throw Object.assign(new Error(`${element.name} não é um campo de texto (sem a ação SetText).`), { code: 'bad-args' });
      const [, owner, node] = String(element.key).split(':'), ownerId = Number(owner), nodeId = Number(node), fallbacks = state.imeFallbacks ?? 0;
      if (element.actions.includes('RequestFocus')) deviceView.queueComposeAction(ownerId, nodeId, 'RequestFocus');   // the field gains focus first: that starts its input session
      // replace the whole text as a person would: select all, then type character by character (each key carries the SetText fallback the field would get without a connection)
      const characters = [...text], ops = [{ kind: 'selectAll', fallbackText: null }, ...(characters.length ? characters.map((character, index) => ({ kind: 'commit', text: character, fallbackText: characters.slice(0, index + 1).join('') })) : [{ kind: 'deleteBackward', fallbackText: '' }])];
      deviceView.queueComposeAction(ownerId, nodeId, 'ime', ops); await flushPendingInputs();
      return { element: element.name, value: text, via: (state.imeFallbacks ?? 0) > fallbacks ? 'SetText (o campo não tem InputConnection; veja o log de execução)' : 'teclado (InputConnection)' };
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
    if (!views.length) throw Object.assign(new Error('Nada rolável na tela.'), { code: 'not-found' });
    const previous = state.pendingScrollBys.get(views[0].id) ?? { dx: 0, dy: 0 }; state.pendingScrollBys.set(views[0].id, { dx: previous.dx + dx, dy: previous.dy + dy }); await flushPendingInputs();
    return { via: 'rolagem da View', id: views[0].id, dx, dy };
  },
  async back() { if (!state.canGoBack) throw Object.assign(new Error('Não há tela anterior para voltar.'), { code: 'bad-args' }); await backAPK(); return { back: true }; },
  scrollTo: args => labScrollCall('scrollTo', args), scrollInfo: args => labScrollCall('info', args),   // to a position / percentage (src/lab-scroll.js), as lab.scrollTo of the plugins
};
// The Controles panel for MCP (src/mcp-tools.js: app_data, device, apps, open_link, host_redirects, permissions): each does what the panel's own control does.
const DEVICE_KEYS_MCP = ['screen', 'orientation', 'locale', 'darkTheme', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'battery', 'connectivity', 'navigation', 'renderer', 'engine', 'eventSeconds', 'memoryMiB', 'raster'];
const waitIdle = async (ms = 60000) => { for (const until = Date.now() + ms; (state.busy || state.runStarting || apkVM.pending) && Date.now() < until;) await new Promise(resolve => setTimeout(resolve, 50)); };
const mcpControls = {
  async appData(payload) {
    if (state.runtime !== apkVM || !state.launchAttempted) throw new Error('Nenhum app em execução: abra e inicie um app primeiro.');
    await waitIdle(); const { appData, snapshot } = await apkVM.appStorage(payload); if (snapshot) renderSnapshot(snapshot); if ($('cp-sec-appdata')?.open && payload.op !== 'overview') appDataPanel.refresh(); return appData;
  },
  device(set = null) {
    const pick = settings => Object.fromEntries(DEVICE_KEYS_MCP.filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
    if (set && typeof set === 'object' && (set.language || set.region)) { const [language, region] = String(set.locale ?? deviceState.settings.locale).split('-'); set = { ...set, locale: `${set.language ?? language}-${String(set.region ?? region).toUpperCase()}` }; delete set.language; delete set.region; }
    if (set && typeof set === 'object') { const unknown = Object.keys(set).filter(key => !DEVICE_KEYS_MCP.includes(key)); if (unknown.length) throw new Error(`Ajustes desconhecidos: ${unknown.join(', ')} (há: ${DEVICE_KEYS_MCP.join(', ')})`); applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, ...set })); }
    return { settings: pick(deviceState.settings), screens: DEVICE_SCREENS.map(([id]) => id), languages: DEVICE_LANGUAGE_CODES, regions: 'any ISO 3166 alpha-2 country (set.region), with set.language: locale = language-REGION', connectivity: ['online', 'metered', 'offline'], appRunning: state.apkRunning };
  },
  async apps(action = 'list', id = null) {
    if (action === 'list') return { apps: apkShelf ? await apkShelf.list().then(items => items.map(({ icon, ...item }) => ({ ...item, current: item.id === state.shelfId }))) : [], running: state.apkRunning, file: state.currentSource?.name ?? null };
    await waitIdle();
    if (action === 'open') { if (!id) throw new Error('id é obrigatório (de apps list)'); await openSavedApp(String(id)); }
    else if (action === 'restart') { if (!state.currentSource) throw new Error('Nenhum APK aberto'); state.needsRestart = true; await runAPK(); }
    else if (action === 'stop') cancelOperation();
    else throw new Error('action é list, open, restart ou stop');
    await waitIdle(); return { running: state.apkRunning, file: state.currentSource?.name ?? null, error: state.lastAPKError ? String(state.lastAPKError.error?.message ?? state.lastAPKError.error) : null };
  },
  async openLink({ link = '', action = '', component = '' } = {}) {
    await waitIdle(); $('deeplink-input').value = link; if (action) $('deeplink-action').value = action; $('deeplink-component').value = component;
    await openDeepLink(); await waitIdle(); const note = $('deeplink-result'); return { state: note?.dataset.state ?? null, message: note?.textContent ?? '' };
  },
  hostRedirects(rules = null) {
    if (Array.isArray(rules)) applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, network: { ...deviceState.settings.network, hostMap: rules } }));
    return { rules: deviceState.settings.network?.hostMap ?? [], allowedHosts: deviceState.settings.network?.allowedHosts ?? [] };
  },
  permissions(name = null, value = null) { if (!permissionsPanel) throw new Error('Permissões não estão disponíveis'); return { permissions: name ? permissionsPanel.set(name, value) : permissionsPanel.list() }; },
};
const mcpTools = createMcpTools({ controls: mcpControls, input: mcpInput, actions: { mock: spec => pluginActions.mock(mcpCaller, spec), unmock: id => pluginActions.unmock(mcpCaller, { id }), mocks: () => pluginActions.mocks(mcpCaller), reload: mode => pluginActions.reload(mcpCaller, { mode }) }, query: (method, args) => pluginHost.query(method, args), plugins: () => pluginHost.list?.() ?? [], clickButton: (id, button) => pluginHost.clickButton(id, button, { by: 'mcp' }), logcat: () => logcatPanel.store.entries, network: () => netlogPanel.store.entries,
  status: () => ({ running: !!apkVM.worker, packageName: state.inventory?.packageName ?? null, file: state.fileName ?? null }) });
mcpLink = createMcpLink({ execute: (tool, args) => mcpTools.execute(tool, args), onState: ({ state: linkState, message, calls, lastTool }) => {
  const connected = linkState === 'conectado';
  $('mcp-summary').textContent = connected ? 'conectado' : linkState === 'conectando' ? 'conectando' : linkState === 'erro' ? 'erro' : 'desligado';
  $('mcp-status').textContent = connected ? `Conectado a ${message}. ${calls ? `${calls} ${calls === 1 ? 'chamada' : 'chamadas'} (última: ${lastTool}).` : 'Peça algo ao cliente MCP.'}` : message || 'Desconectado.';
  $('mcp-status').dataset.state = connected ? 'ok' : linkState === 'erro' ? 'error' : '';
  $('mcp-connect').textContent = connected || linkState === 'conectando' ? 'Desconectar' : 'Conectar';
  syncLogcatStreaming().catch(() => {});   // Logcat lines reach the page while the MCP client may ask for them
} });
// Pairing: the token is generated here (or one pasted from an older setup is kept), saved in this browser, and goes into the JSON for the MCP client's configuration
let mcpAgent = 'claude';   // which agent's setup step 2 shows (Claude, Codex or Cursor)
const saveMcp = () => { try { globalThis.localStorage?.setItem(MCP_KEY, JSON.stringify({ url: $('mcp-url').value, token: $('mcp-token').value, lan: $('mcp-lan').checked, agent: mcpAgent })); } catch { /* the fields last for this page */ } };
// The two things the user copies: the terminal command that starts the bridge with this page's token, and the address (inside the Claude Code command) the agent connects to.
const mcpTexts = masked => {
  const raw = $('mcp-token').value.trim(), token = raw, port = mcpBridgePort($('mcp-url').value), lan = $('mcp-lan').checked, hide = text => masked && raw ? text.replaceAll(encodeURIComponent(raw), '•'.repeat(12)).replaceAll(raw, '•'.repeat(12)) : text;
  let scriptUrl = 'tools/lab-mcp.mjs'; try { scriptUrl = new URL('tools/lab-mcp.mjs', location.href).href; } catch { /* keeps the relative form */ }
  const setup = mcpAgentSetup(mcpAgent, { token, port, host: lan ? '<IP local que a ponte mostrar>' : '127.0.0.1' });
  return { serve: hide(mcpServeCommand({ token, port, origin: location.origin, lan, scriptUrl })), agent: hide(setup.text), where: setup.where, link: lan ? null : setup.link };   // the one-click link needs a real address, so not in the network mode
};
const renderMcpConfig = () => {
  const texts = mcpTexts($('mcp-token').type === 'password'); $('mcp-config-json').textContent = texts.serve; $('mcp-agent-command').textContent = texts.agent; $('mcp-agent-where').textContent = texts.where;
  for (const button of [...($('mcp-agent-pick').querySelectorAll?.('button') ?? [])]) button.setAttribute('aria-pressed', String(button.dataset.agent === mcpAgent));
  const link = $('mcp-agent-link'), real = mcpTexts(false).link; link.hidden = !real; if (real) link.href = real; else link.removeAttribute?.('href');
};
$('mcp-agent-pick').addEventListener('click', event => { const agent = event.target.closest?.('button')?.dataset.agent; if (!MCP_AGENTS.includes(agent)) return; mcpAgent = agent; saveMcp(); renderMcpConfig(); });
try { const saved = JSON.parse(globalThis.localStorage?.getItem(MCP_KEY) ?? 'null'); if (saved?.url) $('mcp-url').value = saved.url; if (saved?.token) $('mcp-token').value = saved.token; $('mcp-lan').checked = !!saved?.lan; if (MCP_AGENTS.includes(saved?.agent)) mcpAgent = saved.agent; } catch { /* storage unavailable */ }
if (!$('mcp-token').value.trim()) { try { $('mcp-token').value = generateMcpToken(); saveMcp(); } catch (error) { $('mcp-status').textContent = String(error?.message ?? error); } }
renderMcpConfig();
for (const id of ['mcp-token', 'mcp-url']) $(id).addEventListener('input', () => { saveMcp(); renderMcpConfig(); });
$('mcp-lan').addEventListener('change', () => { saveMcp(); renderMcpConfig(); });
$('mcp-token-show').addEventListener('click', () => { const show = $('mcp-token').type === 'password'; $('mcp-token').type = show ? 'text' : 'password'; $('mcp-token-show').textContent = show ? 'Ocultar' : 'Mostrar'; $('mcp-token-show').setAttribute('aria-pressed', String(show)); renderMcpConfig(); });
$('mcp-token-new').addEventListener('click', () => {
  if (mcpLink.connected || mcpLink.state.state === 'conectando') mcpLink.disconnect();
  $('mcp-token').value = generateMcpToken(); saveMcp(); renderMcpConfig();
  $('mcp-status').textContent = 'Token novo gerado: pare a ponte, rode o comando de novo e atualize o endereço no agente (a ponte recusa o token antigo).'; $('mcp-status').dataset.state = '';
});
for (const [buttonId, codeId, pick] of [['mcp-copy', 'mcp-config-json', 'serve'], ['mcp-copy-agent', 'mcp-agent-command', 'agent']]) $(buttonId).addEventListener('click', async () => {
  const text = mcpTexts(false)[pick], button = $(buttonId);
  let copied = false; try { await navigator.clipboard.writeText(text); copied = true; } catch { /* no clipboard permission: select the text instead */ }
  if (!copied) { const range = document.createRange(); $(codeId).textContent = text; range.selectNodeContents($(codeId)); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
  button.textContent = copied ? 'Copiado' : 'Selecionado: Ctrl+C'; setTimeout(() => { button.textContent = 'Copiar'; }, 1800);
});
$('mcp-connect').addEventListener('click', () => {
  if (mcpLink.connected || mcpLink.state.state === 'conectando') { mcpLink.disconnect(); return; }
  saveMcp(); mcpLink.connect({ url: $('mcp-url').value, token: $('mcp-token').value });
});   // "Plugins" (src/plugins-panel.js): global list, output cards under the device
// Bottom tool dock (src/tool-dock.js): Log de execução, Logcat, Rede, Compose and Plugins as Android Studio-like tool windows, hidden until an icon is clicked
const toolDock = createToolDock({ root: $('tool-dock'), tools: [
  { id: 'trace', label: 'Log de execução', icon: '☰', details: $('trace'), count: $('trace-count') },
  { id: 'logcat', label: 'Logcat', icon: '▤', details: $('logcat'), count: $('logcat')?.querySelector?.('.logcat-count') },
  { id: 'netlog', label: 'Rede', icon: '⇅', details: $('netlog'), count: $('netlog')?.querySelector?.('.netlog-count') },
  { id: 'examples', label: 'Exemplos', icon: '▤', details: $('scenario-catalog'), count: $('catalog-count') },   // the bundled test APKs: a dock tab, so the page itself does not scroll
  { id: 'compose', label: 'Compose', icon: '◫', details: $('compose-inspector'), count: $('compose-inspector')?.querySelector?.('.ci-count') },
  { id: 'plugins', label: 'Plugins', icon: '⧉', details: $('plugins-output'), count: $('plugins-output')?.querySelector?.('.po-count') },
] });
window.apkLabToolDock = toolDock;   // test and console access
const mocksPanel = createEndpointMocksPanel({ $, vm: apkVM });   // "Mock de endpoints" (src/endpoint-mocks.js): per package, applied live
const hostMapPanel = createHostMapPanel({ $, get: () => deviceState.settings.network.hostMap ?? [], set: rules => applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, network: { ...deviceState.settings.network, hostMap: rules } })) });   // "Redirecionar hosts" (src/host-map.js): device settings, applied live
const deviceView = createDeviceView({ $, state, deviceState, hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, notifyParent, clickView: id => clickView(id), hooks: {
  cameraSurface(element, info) { cameraLab.bindSurface(element, info); },
  navigationChanged(canGoBack) { $('back-button').disabled = state.busy || !canGoBack; $('back-button').hidden = state.mode !== 'apk' || !canGoBack; syncReloadButton(); },
  closed() {
    taskSwitcher?.closed();   // the device shows its launcher: the app's icon starts it again
    if (state.mode === 'apk') { setStatus('Aplicativo encerrado · nenhuma Activity ativa'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> ENCERRADO'; }
  },
  rendered(snapshot, composeReady) {
    syncReloadButton(); showScreenReady(snapshot.screenReady); showWarmup(snapshot.warmup); taskSwitcher?.sync(snapshot, state.inventory);
    overridesPanel.hits(snapshot.methodOverrides); ignoredPanel.hits(snapshot.ignoredActivities); mocksPanel.hits(snapshot.endpointMocks); hostMapPanel.hits(snapshot.hostMap);
    hideBoot({ force: true }); $('empty-preview').hidden = true; updateMemoryMeter(snapshot.vmHealth); showCoreUsage(snapshot.vmHealth); state.lastSnapshot = snapshot; redrawLayoutBounds(); if (snapshot.vmHealth) state.lastVmHealth = snapshot.vmHealth; if (snapshot.vmHealth?.renderer) showRendererStatus(snapshot.vmHealth.renderer, true); composeInspector.rendered(snapshot); pluginHost.snapshot(snapshot);
    if (snapshot.droppedEvent) appendTrace(`Evento descartado: a View ${snapshot.droppedEvent.id} (${snapshot.droppedEvent.type}) já não existe na VM.`);
    // The VM raised java.lang.OutOfMemoryError (even if the app caught it): never silent.
    if ((snapshot.vmHealth?.oomCount ?? 0) > (state.oomSeen ?? 0)) { state.oomSeen = snapshot.vmHealth.oomCount; appendTrace(`OutOfMemoryError: ${snapshot.vmHealth.lastOom?.reason} (${snapshot.vmHealth.liveObjects} objetos vivos)`); setStatus(`java.lang.OutOfMemoryError na VM (${snapshot.vmHealth.liveObjects} objetos vivos, limite ${snapshot.vmHealth.limit})`, 'error'); }
    if (state.mode === 'apk') { $('runtime-badge').className = 'runtime-badge running'; $('runtime-badge').innerHTML = '<span></span> EM EXECUÇÃO'; $('preview-name').textContent = snapshot.activityName?.split('.').pop() || state.inventory?.packageName || 'APK local'; if (composeReady === false) { $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> INICIALIZADO'; setStatus('Activity iniciada · composição ainda sem conteúdo acessível e desenhado'); } else setStatus('Activity em execução · interaja com a interface', 'ok'); }
    taskSwitcher?.restate();
  },
} });
const { renderSnapshot, flushPendingInputs, updateSystemBarIcons } = deviceView; deviceView.bindVM(apkVM);
taskSwitcher = createTaskSwitcher({ shelf: { open: id => openSavedApp(id), remove: item => removeSavedApp(item) }, onInfo: info => { if (state.shelfId && apkShelf && (info?.label || info?.icon)) apkShelf.describe(state.shelfId, { label: info.label ?? null, icon: info.icon ?? null }).then(refreshShelf).catch(() => {}); }, $, vm: () => state.runtime, render: snapshot => renderSnapshot(snapshot), back: () => backAPK(), relaunch: () => runAPK(), canGoBack: () => !!state.canGoBack, busy: () => state.busy || !state.runtime,
  begin: message => beginOperation(message), finish: token => finishOperation(token), report: (message, error) => { if (error) reportAPKError(error, 'Navegação do dispositivo'); else appendTrace(message); },
  announce: mode => { if (state.mode !== 'apk' || !['overview', 'home', 'closed'].includes(mode)) return; setStatus(mode === 'closed' ? 'Aplicativo encerrado · toque no ícone para abrir de novo' : 'Aplicativo em segundo plano (onPause, onStop) · toque para voltar'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = mode === 'closed' ? '<span></span> ENCERRADO' : '<span></span> EM PAUSA'; } });
// The stage changes size when the window does or a dock panel opens (the workspace fills the viewport above the dock): the device is fitted again.
// "−  70%  +" over the stage's top right corner (src/device-zoom.js): the device's scale on the stage; the label resets to "fit".
const refitDevice = () => { sizeBootOverlay(); if (deviceState.bars) deviceView.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); else { const d = resolveDevice(deviceState.settings); deviceView.fitDevice(d.widthDp, d.heightDp); } };
const deviceZoom = createDeviceZoom({ stage: $('preview-stage'), deviceState, refit: refitDevice, shownScale: () => Number($('android-device')?.style?.getPropertyValue?.('--scale')) || 0.7 });
if (typeof ResizeObserver === 'function' && $('preview-stage')) new ResizeObserver(() => { const stage = $('preview-stage'); stage.style.setProperty('--stage-h', `${stage.clientHeight}px`); sizeBootOverlay(); deviceZoom?.sync(); if (deviceState.bars) deviceView.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); }).observe($('preview-stage'));
createDeviceFullscreen({ stage: $('preview-stage'), openButton: $('fullscreen-button'), closeButton: $('fullscreen-close'), deviceState, refit: () => { if (deviceState.bars) deviceView.fitDevice(deviceState.bars.widthDp, deviceState.bars.heightDp); } });   // "Tela cheia" (src/device-fullscreen.js): CSS scale only
const customScreenPanel = createCustomScreenPanel({ $ });   // "Tela" -> "Personalizado" (src/custom-screen-panel.js)
// ---- Virtual device settings panel ("Dispositivo virtual") ----
// Idioma and Região of the device: the locale is language-REGION (any ISO 3166 country with any of these languages: en-BR, pt-PT ...). Names come from the browser's Intl.DisplayNames.
const DEVICE_LANGUAGE_CODES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'ar', 'he', 'hi', 'ja', 'ko', 'zh'];
const displayName = (type, code) => { try { return new Intl.DisplayNames(['pt-BR'], { type }).of(code) ?? code; } catch { return code; } };
const capital = text => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
const DEVICE_LANGUAGES = DEVICE_LANGUAGE_CODES.map(code => [code, `${capital(displayName('language', code))}${code === 'ar' || code === 'he' ? ' (RTL)' : ''}`]);
const DEVICE_REGIONS = Object.keys(ISO_COUNTRIES).map(code => [code, `${displayName('region', code)} (${code})`]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
const DEVICE_ZONES = [['', 'Seguir o navegador'], ['America/Sao_Paulo', 'São Paulo (UTC−3)'], ['UTC', 'UTC'], ['America/New_York', 'Nova York'], ['Europe/London', 'Londres'], ['Europe/Paris', 'Paris'], ['Asia/Kolkata', 'Índia (UTC+5:30)'], ['Asia/Tokyo', 'Tóquio'], ['Australia/Sydney', 'Sydney']];
const DEVICE_SCREENS = [['phone', 'Telefone · 411 × 914 dp'], ['compact', 'Compacto · 360 × 800 dp'], ['large', 'Grande · 412 × 892 dp'], ['small', 'Pequeno · 320 × 640 dp'], ['tablet', 'Tablet · 800 × 1280 dp'], ['custom', 'Personalizado…']];
const fillSelect = (select, entries) => { select.replaceChildren(...entries.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; })); };
// "Internet" in the preview bar: the device's connectivity in one click (Controles › Dispositivo › Conectividade, applied live). Off is "Sem conexão"; on is the mode it had before.
let lastOnlineConnectivity = 'online';
function syncNetworkToggle(settings) {
  const button = $('network-toggle'); if (!button) return; const offline = settings.connectivity === 'offline';
  if (!offline) lastOnlineConnectivity = settings.connectivity;
  button.setAttribute('aria-pressed', offline ? 'true' : 'false'); button.classList.toggle('offline', offline); button.textContent = offline ? 'Sem internet' : 'Internet';
}
$('network-toggle')?.addEventListener('click', () => {
  const offline = deviceState.settings.connectivity === 'offline';
  applyDeviceSettings(sanitizeSettings({ ...deviceState.settings, connectivity: offline ? lastOnlineConnectivity : 'offline' }));
  setStatus(offline ? 'Internet do aparelho ligada' : 'Internet do aparelho desligada: o app vê o aparelho sem conexão');
});
function writeDevicePanel(settings) {
  syncNetworkToggle(settings);
  $('dev-screen').value = settings.screen; $('dev-orientation').value = settings.orientation; $('dev-font').value = String(settings.fontScale); $('dev-font-out').textContent = `${settings.fontScale.toFixed(2).replace('.', ',')}×`;
  { const [language, region] = String(settings.locale).split('-'); $('dev-locale').value = language; if ($('dev-region')) $('dev-region').value = region; } $('dev-dark').checked = settings.darkTheme; $('dev-animator').value = String(settings.animatorScale); $('dev-hour24').checked = settings.hour24; $('dev-tz').value = settings.timeZone;
  $('dev-battery').value = String(settings.battery.level); $('dev-battery-out').textContent = `${settings.battery.level}%`; $('dev-charging').checked = settings.battery.charging; $('dev-network').value = settings.connectivity; $('dev-nav').value = settings.navigation; { const all = settings.network.allowedHosts.includes('*'); $('dev-hosts-all').checked = all; $('dev-hosts').disabled = all; $('dev-hosts').value = all ? '*' : settings.network.allowedHosts.join(', '); } $('dev-layout-bounds').checked = !!settings.layoutBounds; $('dev-proxy').value = settings.network.proxyUrl; if ($('vm-memory')) $('vm-memory').value = String(settings.memoryMiB); writeCoreMemory(settings.coreMemory);
  if ($('vm-event-time')) $('vm-event-time').value = String(settings.eventSeconds ?? 0);
  if ($('vm-renderer')) $('vm-renderer').value = settings.renderer ?? 'gpu'; showEngine(settings);
  if ($('vm-raster-scale')) $('vm-raster-scale').value = String(settings.raster?.motionScale ?? 1); if ($('vm-raster-still')) $('vm-raster-still').value = String(settings.raster?.stillScale ?? 1); if ($('vm-raster-navigation')) $('vm-raster-navigation').checked = settings.raster?.navigation === true;
  customScreenPanel.write(settings);
  const device = resolveDevice(settings); $('device-summary').textContent = `${device.widthDp} × ${device.heightDp} · ${settings.orientation === 'landscape' ? 'paisagem' : 'retrato'}`;
}
function readDevicePanel() {
  return sanitizeSettings({ screen: $('dev-screen').value, customScreen: customScreenPanel.read(deviceState.settings.customScreen), orientation: $('dev-orientation').value, fontScale: Number($('dev-font').value), locale: `${$('dev-locale').value}-${$('dev-region')?.value || 'US'}`, darkTheme: $('dev-dark').checked, animatorScale: Number($('dev-animator').value),
    hour24: $('dev-hour24').checked, timeZone: $('dev-tz').value, battery: { level: Number($('dev-battery').value), charging: $('dev-charging').checked }, connectivity: $('dev-network').value, navigation: $('dev-nav').value, layoutBounds: $('dev-layout-bounds').checked, eventSeconds: Number($('vm-event-time')?.value ?? 0), raster: { motionScale: Number($('vm-raster-scale')?.value ?? 0.5), navigation: $('vm-raster-navigation')?.checked === true, stillScale: Number($('vm-raster-still')?.value ?? 1) }, renderer: $('vm-renderer')?.value ?? 'gpu', engine: URL_ENGINE ? deviceState.settings?.engine ?? DEFAULT_ENGINE : $('vm-engine')?.value ?? DEFAULT_ENGINE, coreMemory: readCoreMemory(), network: { allowedHosts: $('dev-hosts-all').checked ? ['*'] : $('dev-hosts').value.split(/[\s,]+/).filter(host => host !== '*'), proxyUrl: $('dev-proxy').value, hostMap: deviceState.settings.network?.hostMap ?? [] }, memoryMiB: Number($('vm-memory')?.value ?? 0), location: deviceState.settings.location });
}
// "Memória da VM": the Java heap budget (object limit) used at the next load; the VM limit of each step is memoryBudget({ override }).maxHeapObjects, the same rule the Worker applies (heapLimitFor).
const vmMemoryLabel = mibValue => { const { maxHeapObjects } = memoryBudget({ override: mibValue }); return `${mibValue >= 1024 ? `${mibValue / 1024} GiB` : `${mibValue} MiB`} · ${maxHeapObjects.toLocaleString('pt-BR')} objetos`; };
function initVmEventTime() {
  const select = $('vm-event-time'); if (!select) return;
  fillSelect(select, [['0', 'Automático (padrão) · 25 s por evento'], ...EVENT_SECONDS_STEPS.map(value => [String(value), value >= 120 ? `${value / 60} min por evento` : `${value} s por evento`])]);
}
function initVmMemory() {
  const select = $('vm-memory'); if (!select) return;
  const auto = memoryBudget({ deviceMemory: globalThis.navigator?.deviceMemory ?? null });
  fillSelect(select, [['0', `Automático (padrão) · ${auto.budgetMiB} MiB · ${auto.maxHeapObjects.toLocaleString('pt-BR')} objetos`], ...MEMORY_STEPS_MIB.map(value => [String(value), vmMemoryLabel(value)])]);
  const device = globalThis.navigator?.deviceMemory; $('vm-memory-device').textContent = device != null ? `Este navegador informa ${device} GiB de memória no dispositivo.` : 'Este navegador não informa a memória do dispositivo.';
}
// "Renderização": the backend in use (the GPU's name when the browser exposes it) and why the GPU is not in use after a fallback.
let rendererShown = '';
function showRendererStatus(status, fromSnapshot = false) {
  const note = $('vm-renderer-status'); if (!note) return;
  const key = status ? `${status.requested}|${status.active}|${status.reason ?? ''}|${status.gpuRenderer ?? ''}` : ''; if (fromSnapshot && key === rendererShown) return;
  if (status?.reason && status.reason !== rendererShown.split('|')[2] && status.requested === 'gpu') appendTrace(`GPU indisponível: ${status.reason} — usando CPU`);
  rendererShown = key;
  const requested = deviceState.settings?.renderer ?? 'gpu';
  if (!status) { note.textContent = apkVM.worker ? 'Em uso: CPU' : `Em uso: CPU${requested === 'gpu' ? ' · GPU no próximo lançamento' : ''}`; note.dataset.state = ''; return; }
  if (status.active === 'gpu') { note.textContent = `Em uso: GPU (${status.api ?? 'WebGL'}${status.gpuRenderer ? ` · ${status.gpuRenderer}` : ''})`; note.dataset.state = 'gpu'; }
  else if (status.requested === 'gpu' || (requested === 'gpu' && status.reason)) { note.textContent = `GPU indisponível: ${status.reason ?? 'motivo desconhecido'} — usando CPU`; note.dataset.state = 'fallback'; }
  else { note.textContent = 'Em uso: CPU'; note.dataset.state = ''; }
  note.title = note.textContent;
}
// The hint shows while a loaded APK was opened with another budget than the one selected now (the budget is read by `load`, never applied live).
function updateVmMemoryHint() { const hint = $('vm-memory-hint'); if (hint) hint.hidden = !(apkVM.worker && state.loadedMemoryMiB !== undefined && state.loadedMemoryMiB !== deviceState.settings.memoryMiB); const core = $('vm-core-hint'); if (core) core.hidden = !(apkVM.worker && state.loadedCoreMemory && !sameCoreMemory(state.loadedCoreMemory, deviceState.settings.coreMemory)); const engine = $('vm-engine-hint'); if (engine) engine.hidden = !(apkVM.worker && state.loadedEngine && state.loadedEngine !== engineForLoad()); }
/* "Motor da VM": the WebAssembly core (default) or the JavaScript VM, read by `load`. `?engine=js|wasm` in the address wins over the stored choice and locks the select. */
const URL_ENGINE = ['js', 'wasm'].includes(params.get('engine')) ? params.get('engine') : null;
function engineForLoad() { return URL_ENGINE ?? deviceState.settings?.engine ?? DEFAULT_ENGINE; }
function showEngine(settings) {
  const select = $('vm-engine'), note = $('vm-engine-note'); if (!select) return;
  select.value = URL_ENGINE ?? settings.engine ?? DEFAULT_ENGINE; select.disabled = !!URL_ENGINE;
  if (note) note.textContent = URL_ENGINE ? `Definido pelo endereço da página (?engine=${URL_ENGINE}); remova o parâmetro para escolher aqui.` : select.value === 'js' ? 'VM JavaScript: a memória é a de "Memória da VM"; os campos do núcleo Wasm não valem.' : 'Núcleo WebAssembly: a memória é a de "Memória do núcleo Wasm"; "Memória da VM" não vale.';
}
// "Memória do núcleo Wasm" (src/core-memory.js): heap, metaspace and live threads of the WebAssembly core, read by the next load. A combination that does not fit the core's
// 2 GiB is shown as an error and not saved (the last valid one stays).
const CORE_FIELDS = [['vm-core-heap', 'heapMiB'], ['vm-core-meta', 'metaMiB'], ['vm-core-threads', 'threads']];
function writeCoreMemory(memory) { for (const [id, key] of CORE_FIELDS) { const input = $(id); if (input && document.activeElement !== input) input.value = String(memory[key]); } showCoreMemoryTotal(memory); }
function showCoreMemoryTotal(raw) {
  const note = $('vm-core-total'); if (!note) return null; const checked = checkCoreMemory(raw);
  note.dataset.state = checked.error ? 'error' : ''; note.textContent = checked.error ? `Não cabe: ${checked.error}. Mantido o último valor válido.` : `Total reservado: ${checked.totalMiB} de 2048 MiB${sameCoreMemory(checked.value, CORE_MEMORY_DEFAULT) ? ' (padrão)' : ''}.`;
  return checked;
}
/** What the running core uses of each region (from the frame's vmHealth), under the fields; hidden on the JavaScript VM. */
let coreUsageShown = '';
function showCoreUsage(health) {
  const note = $('vm-core-usage'); if (!note) return; const core = health?.core ?? null, mib = bytes => Math.round(bytes / 1048576);
  const text = core ? `Em uso agora: metaspace ${mib(core.metaBytes)} de ${mib(core.metaCapacity)} MiB · ${core.threads} de ${core.threadCapacity} threads · heap de ${mib(core.heapBytes)} MiB${core.liveBytes != null ? ` (${mib(core.liveBytes)} MiB vivos na última coleta)` : ''}.` : '';
  if (text === coreUsageShown) return; coreUsageShown = text; note.hidden = !text; note.textContent = text;
}
function readCoreMemory() {
  const raw = Object.fromEntries(CORE_FIELDS.map(([id, key]) => [key, $(id)?.value ?? ''])), checked = showCoreMemoryTotal(raw);
  return !checked || checked.error ? deviceState.settings.coreMemory : checked.value;
}
let deviceApplying = Promise.resolve();
function applyDeviceSettings(settings) {
  const rendererChanged = (deviceState.settings?.renderer ?? 'cpu') !== (settings.renderer ?? 'cpu');
  const timeChanged = (deviceState.settings?.eventSeconds ?? 0) !== (settings.eventSeconds ?? 0), rasterChanged = JSON.stringify(deviceState.settings?.raster ?? null) !== JSON.stringify(settings.raster ?? null);
  deviceState.settings = settings; updateVmMemoryHint(); saveDeviceSettings(settings);
  if (rasterChanged && apkVM.worker && params.get('raster') !== 'full') apkVM.setRasterSettings({ scale: settings.raster.motionScale, navigation: settings.raster.navigation, settled: settings.raster.stillScale }).catch(() => {});   // "Resolução no movimento" / "Tela nova em baixa resolução" (src/motion-raster.js)
  if (rendererChanged) { if (apkVM.worker) apkVM.setRenderer(settings.renderer).then(showRendererStatus, error => showRendererStatus({ requested: settings.renderer, active: 'cpu', reason: String(error?.message ?? error) })); else showRendererStatus(null); }   // "Renderização" applies live (src/gpu-raster.js)
  if (timeChanged && apkVM.worker) apkVM.setTimeLimits(settings.eventSeconds).catch(() => {});   // "Tempo máximo por evento" applies to the running VM at once (src/time-limits.js)
  writeDevicePanel(settings); updateSystemBarIcons(); redrawLayoutBounds();
  const note = $('device-status');
  if (state.runtime !== apkVM || !state.apkRunning) { note.textContent = 'Nenhum app em execução: as configurações valem desde o próximo lançamento.'; return deviceApplying; }
  // One RPC at a time: wait for a VM operation in flight, then deliver the newest settings through ActivityThread semantics.
  deviceApplying = deviceApplying.then(async () => {
    for (let attempt = 0; attempt < 100 && apkVM.pending; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    const latest = deviceState.settings;
    try {
      const { outcome, snapshot } = await apkVM.setDevice(deviceForVM(latest));
      if (snapshot) renderSnapshot(snapshot);
      note.textContent = outcome?.changed ? `Aplicado ao vivo: ${outcome.relaunched ? `${outcome.relaunched} Activity recriada(s) com estado salvo` : ''}${outcome.relaunched && outcome.delivered ? ' · ' : ''}${outcome.delivered ? `${outcome.delivered} onConfigurationChanged` : ''}${!outcome.relaunched && !outcome.delivered ? 'sem mudança de Configuration (barra de status, rede/bateria/fuso)' : ''}.` : 'Sem alteração para o app.';
    } catch (error) { note.textContent = 'O app não aceitou a mudança: ' + (error?.message || error); reportAPKError(error, 'Mudança de configuração do dispositivo interrompida'); }
  });
  return deviceApplying;
}
function initDevicePanel() {
  fillSelect($('dev-screen'), DEVICE_SCREENS); fillSelect($('dev-locale'), DEVICE_LANGUAGES); if ($('dev-region')) fillSelect($('dev-region'), DEVICE_REGIONS); fillSelect($('dev-tz'), DEVICE_ZONES); initVmMemory(); initVmEventTime(); writeDevicePanel(deviceState.settings);
  for (const id of ['dev-screen', 'dev-custom-w', 'dev-custom-h', 'dev-custom-unit', 'dev-orientation', 'dev-font', 'dev-locale', 'dev-region', 'dev-dark', 'dev-animator', 'dev-hour24', 'dev-tz', 'dev-battery', 'dev-charging', 'dev-network', 'dev-nav', 'dev-hosts-all', 'dev-layout-bounds', 'dev-hosts', 'dev-proxy', 'vm-memory', 'vm-event-time', 'vm-raster-scale', 'vm-raster-still', 'vm-raster-navigation', 'vm-renderer', 'vm-engine']) $(id).addEventListener('input', () => { applyDeviceSettings(readDevicePanel()); });
  for (const [id] of CORE_FIELDS) { $(id)?.addEventListener('change', () => { if (showCoreMemoryTotal(Object.fromEntries(CORE_FIELDS.map(([field, key]) => [key, $(field)?.value ?? ''])))?.error) return; applyDeviceSettings(readDevicePanel()); }); /* a combination that does not fit stays on screen with its reason, and is not applied */ $(id)?.addEventListener('input', () => { showCoreMemoryTotal(Object.fromEntries(CORE_FIELDS.map(([field, key]) => [key, $(field)?.value ?? '']))); }); }
  $('vm-core-reset')?.addEventListener('click', () => { for (const [id, key] of CORE_FIELDS) $(id).value = String(CORE_MEMORY_DEFAULT[key]); applyDeviceSettings(readDevicePanel()); });
  document.querySelector('#trace .trace-actions')?.addEventListener('click', event => event.preventDefault());   // buttons in the <summary> must not toggle the panel
  $('device-reset').addEventListener('click', () => { applyDeviceSettings(defaultDeviceSettings()); hostMapPanel.refresh(); permissionsPanel.refreshLocation(); if (apkVM.worker) apkVM.setPermissions({ location: deviceState.settings.location }).catch(() => {}); });
}
// ---- "Abrir": a deep link / Intent resolved against the manifest's intent filters (src/deep-link-host.js) ----
const deepLinkPanel = { history: [], busy: false };
function showDeepLinkResult(state, message, detail = '') {
  const note = $('deeplink-result'); note.dataset.state = state; note.textContent = message;
  if (detail) { const small = document.createElement('small'); small.textContent = detail; note.append(small); }
}
function renderDeepLinkHistory() {
  const list = $('deeplink-history-list'), items = deepLinkPanel.history;
  $('deeplink-history').hidden = !items.length;
  list.replaceChildren(...items.map((entry) => {
    const item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = historyLabel(entry); button.title = historyLabel(entry);
    button.addEventListener('click', () => { $('deeplink-input').value = entry.link; $('deeplink-component').value = entry.component; $('deeplink-action').value = entry.action; $('deeplink-input').focus(); });
    item.append(button); return item;
  }));
}
async function openDeepLink() {
  if (deepLinkPanel.busy) return;
  let request;
  try { request = buildDeepLinkRequest({ link: $('deeplink-input').value, action: $('deeplink-action').value, component: $('deeplink-component').value }); }
  catch (error) { showDeepLinkResult('error', error.message); return; }
  if (!state.runtime || state.busy) { showDeepLinkResult('error', state.runtime ? 'A VM está ocupada; tente de novo em instantes.' : 'Abra um APK primeiro: o link é resolvido pelos filtros do manifesto dele.'); return; }
  deepLinkPanel.busy = true; $('deeplink-open').disabled = true;
  try {
    await flushPendingInputs(); switchMode('apk'); hideError(); state.lastAPKError = null; state.stickyError = false;
    const token = beginOperation('Abrindo link…'); state.runStartedAt = Date.now();
    try {
      const { deepLink, snapshot } = await state.runtime.startIntent(request, { onProgress: onWorkerProgress });
      if (token === state.operation) {
        if (deepLink?.ok && deepLink.launched) state.launchAttempted = true;
        if (snapshot) renderSnapshot(snapshot);
        const result = describeDeepLink(deepLink); showDeepLinkResult(result.state, result.message, result.detail);
        deepLinkPanel.history = addToHistory(deepLinkPanel.history, { link: $('deeplink-input').value, action: $('deeplink-action').value, component: $('deeplink-component').value });
        saveHistory(deepLinkPanel.history); renderDeepLinkHistory();
      }
    } catch (error) { if (token === state.operation) { showDeepLinkResult('error', 'A Activity encontrada não pôde ser iniciada: ' + (error?.message || error)); reportAPKError(error, 'Não foi possível abrir o link'); } }
    finally { finishOperation(token); }
  } finally { deepLinkPanel.busy = false; $('deeplink-open').disabled = false; }
}
function initDeepLinkPanel() {
  deepLinkPanel.history = loadHistory(); renderDeepLinkHistory();
  $('deeplink-form').addEventListener('submit', (event) => { event.preventDefault(); openDeepLink(); });
  $('deeplink-history-clear').addEventListener('click', () => { deepLinkPanel.history = []; saveHistory([]); renderDeepLinkHistory(); });
}
async function runAPK() {
  if (!(state.runtime || (state.needsRestart && state.currentSource)) || state.busy || state.runStarting) return;
  state.runStarting = true; showBoot('Iniciando o aplicativo…');
  try { await runAPKOnce(); } finally { state.runStarting = false; }
}
async function runAPKOnce(retried = false) {
  await flushPendingInputs();
  const activity = $('activity-select').value || undefined;
  if (state.launchAttempted || state.needsRestart) {   // a second run, or a run after a failure: the APK is reopened in a fresh Worker (a VM left busy or broken by the failure is replaced)
    const source = state.currentSource;
    if (!source) return;
    await importSource(source);
    if (!state.runtime || state.busy) return;
    if (activity && [...$('activity-select').options].some(option => option.value === activity)) $('activity-select').value = activity;
  }
  await taskSwitcher?.infoSettled?.();   // the launcher's label and icon request of the load just finished (the VM client takes one request at a time)
  switchMode('apk'); hideError(); state.lastAPKError = null; state.stickyError = false; state.launchAttempted = true;
  const token = beginOperation('Tentando iniciar a Activity…');
  state.runStartedAt = Date.now(); const launchStarted = performance.now();
  try { const snapshot = await state.runtime.launch(activity, { onProgress: onWorkerProgress }); if (token === state.operation) { renderSnapshot(snapshot); if ($('cp-sec-appdata')?.open) setTimeout(() => appDataPanel.refresh(), 0); if (state.loadTimes) { state.loadTimes.launchMs = Math.round(performance.now() - launchStarted); showLoadTimes(); appendTrace(`Activity aberta em ${state.loadTimes.launchMs} ms`); } } }
  catch (error) {
    // The Worker was still inside an earlier operation (a run that failed while it kept working): start over once in a fresh Worker instead of reporting "already busy".
    if (token === state.operation && !retried && error?.name === 'ProtocolError' && /processando/.test(error.message ?? '')) { finishOperation(token); state.needsRestart = true; return runAPKOnce(true); }
    if (token === state.operation) reportAPKError(error);
  }
  finally { finishOperation(token); }
}
async function reloadActivity(mode = 'recreate') {
  if (!state.runtime || state.busy || !state.apkRunning) return;
  await flushPendingInputs(); hideError(); state.stickyError = false; const token = beginOperation(mode === 'reopen' ? 'Reabrindo a Activity…' : 'Recriando a Activity…');
  try { const snapshot = await state.runtime.reloadActivity({ mode, onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Não foi possível recarregar a Activity'); }
  finally { finishOperation(token); }
}
async function backAPK() {
  if (!state.runtime || state.busy || !state.canGoBack) return;
  await flushPendingInputs(); hideError(); state.stickyError = false; const token = beginOperation('Retornando à Activity anterior…');
  try { const snapshot = await state.runtime.back({ onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Não foi possível voltar'); }
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
  const token = beginOperation('Executando callback DEX…');
  try { const snapshot = await state.runtime.click(id, { onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error, 'Callback interrompido'); }
  finally { finishOperation(token); }
}
async function runDemo() {
  if (state.busy || state.noBundledApks) return;   // the published site carries no APKs: the demo is a local/test-build feature
  await importSource({ name: 'kotlin-counter.apk', url: new URL('./fixtures/kotlin-counter.apk', import.meta.url).href }, true);
}
async function inspectCatalogAPK(entry) {
  if (state.busy) return;
  await importSource({ name: entry.file, url: new URL(`./fixtures/${encodeURIComponent(entry.file)}`, import.meta.url).href });
  $('inspection-badge').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
}
async function loadScenarioCatalog() {
  const list = $('scenario-list');
  try {
    const response = await fetch(new URL('./fixtures/catalog.json', import.meta.url), { cache: 'no-store' });
    // A build without bundled APKs (the public site: scripts/publish-site.mjs leaves them out) has no catalog: the page is only for the user's own APKs, so the library and the demo go away.
    if (response.status === 404) { state.noBundledApks = true; $('scenario-catalog').hidden = true; document.querySelector('.demo-row')?.setAttribute('hidden', ''); if (!state.currentSource) $('empty-preview').querySelector('p').innerHTML = emptyPreviewHint(); return; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.scenarios)) throw new Error('Formato de catálogo inválido');
    if ($('catalog-count')) $('catalog-count').textContent = String(catalog.scenarios.length);
    const cards = catalog.scenarios.map((entry) => {
      // The catalog names packaged fixtures; it never supplies runtime data or behavior.
      if (!/^[a-z0-9-]+\.apk$/i.test(entry.file)) throw new Error('Nome de APK inválido no catálogo');
      const available = entry.available !== false;
      const card = document.createElement('article'); card.className = 'scenario-card';
      const top = document.createElement('div'); top.className = 'scenario-card-top';
      const icon = document.createElement('span'); icon.className = 'scenario-file-icon'; icon.textContent = 'APK';
      const badge = document.createElement('span'); badge.className = `scenario-badge${entry.executionValidated ? ' supported' : ''}`;
      badge.textContent = available ? entry.executionValidated ? 'Validado' : 'Experimental' : 'Em build';
      top.append(icon, badge);
      const title = document.createElement('h3'); title.textContent = entry.title;
      const description = document.createElement('p'); description.textContent = entry.description;
      const tags = document.createElement('div'); tags.className = 'scenario-tags';
      (entry.tags || []).forEach((text) => { const tag = document.createElement('span'); tag.textContent = text; tags.append(tag); });
      const file = document.createElement('div'); file.className = 'scenario-filename'; file.textContent = entry.file; if (entry.sizeBytes) { const size = document.createElement('span'); size.className = 'scenario-size'; size.textContent = formatSize(entry.sizeBytes); file.append(' ', size); }
      const actions = document.createElement('div'); actions.className = 'scenario-actions';
      const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Inspecionar';
      inspect.dataset.inspectApk = entry.id; inspect.dataset.available = String(available); inspect.disabled = state.busy || !available;
      inspect.addEventListener('click', () => { if (toolDock.active === 'examples') toolDock.close(); inspectCatalogAPK(entry); });   // the list is a dock tab: it gets out of the way of the device
      const download = document.createElement('a'); download.textContent = 'Baixar';
      if (available) { download.href = new URL(`./fixtures/${encodeURIComponent(entry.file)}`, import.meta.url).href; download.download = entry.file; }
      else { download.setAttribute('aria-disabled', 'true'); download.title = 'Este APK ainda está em build'; }
      actions.append(inspect, download); card.append(top, title, description, tags, file, actions); return card;
    });
    list.replaceChildren(...cards);
  } catch (error) {
    const message = document.createElement('p'); message.className = 'catalog-loading'; message.textContent = `Catálogo indisponível: ${error.message}. Tente recarregar a página.`; list.replaceChildren(message);
  }
}
// The lab has a single mode (APK); switchMode('apk') resets the preview chrome to the APK's current state.
function switchMode() {
  state.mode = 'apk';
  $('back-button').hidden = !state.canGoBack; syncReloadButton();
  if (!state.apkRunning) showDeviceHome(); else { $('android-device').hidden = false; $('android-device').inert = false; $('empty-preview').hidden = true; }
  hideError();
  $('execution-engine').textContent = '411 × 840 dp · DENSIDADE 1';
  $('preview-name').textContent = state.inventory?.packageName || 'Prévia do aplicativo';
  const running = state.apkRunning;
  $('runtime-badge').className = `runtime-badge${running ? ' running' : ''}`;
  $('runtime-badge').innerHTML = `<span></span> ${running ? 'EM EXECUÇÃO' : state.inventory?.unsupportedFeatures?.length ? 'BLOQUEADO' : state.runtime ? 'INSPECIONADO' : 'INATIVO'}`;
  if (state.lastAPKError) { showError(state.lastAPKError.error, state.lastAPKError.title); return; }
  setStatus(running ? 'Activity em execução · interaja com a interface' : state.inventory?.unsupportedFeatures?.length ? 'APK identificado · execução bloqueada por recursos não suportados' : state.runtime ? 'Inspecionado · tentativa de execução disponível' : 'Aguardando um aplicativo', running ? 'ok' : state.inventory?.unsupportedFeatures?.length ? 'error' : '');
}
$('apk-file').addEventListener('change', (event) => { chooseFile(event.target.files?.[0]); event.target.value = ''; });
$('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); if (!state.busy) $('drop-zone').classList.add('dragging'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('dragging'));
// The file handle of a dropped file (Chrome: DataTransferItem.getAsFileSystemHandle) must be asked for during the drop event itself; the saved app keeps it (src/apk-shelf.js).
const droppedHandle = event => { try { return [...(event.dataTransfer?.items ?? [])].find(item => item.kind === 'file')?.getAsFileSystemHandle?.() ?? null; } catch { return null; } };
$('drop-zone').addEventListener('drop', (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); chooseFile(event.dataTransfer.files?.[0], droppedHandle(event)); });
// Choosing the file: the browser's file picker with a handle where there is one (showOpenFilePicker), the plain file input otherwise.
$('drop-zone').addEventListener('click', async event => {
  if (typeof window.showOpenFilePicker !== 'function' || state.busy) return;
  event.preventDefault();
  try { const [handle] = await window.showOpenFilePicker({ types: [{ description: 'APK', accept: { 'application/vnd.android.package-archive': ['.apk'] } }], excludeAcceptAllOption: false }); if (handle) chooseFile(await handle.getFile(), handle); }
  catch (error) { if (error?.name !== 'AbortError') $('apk-file').click(); }
});
// The device takes an APK too: dropped on the stage it is installed like one dropped on the panel.
{ const stage = $('preview-stage'), hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');
  stage.addEventListener('dragover', event => { if (!hasFiles(event)) return; event.preventDefault(); if (!state.busy) stage.classList.add('apk-dragging'); });
  stage.addEventListener('dragleave', event => { if (!stage.contains(event.relatedTarget)) stage.classList.remove('apk-dragging'); });
  stage.addEventListener('drop', event => { if (!hasFiles(event)) return; event.preventDefault(); stage.classList.remove('apk-dragging'); chooseFile(event.dataTransfer.files?.[0], droppedHandle(event)); }); }
showDeviceHome(state.homeMode ?? 'idle');   // by default the stage shows the Android device on its launcher
refreshShelf();   // the apps saved by earlier visits, on that launcher
$('run-button').addEventListener('click', runAPK);
$('back-button').addEventListener('click', backAPK);
$('recreate-activity')?.addEventListener('click', () => reloadActivity('recreate'));   // the toolbar no longer has this button; lab.reloadActivity still recreates
$('reopen-activity').addEventListener('click', () => reloadActivity('reopen'));
$('cancel-operation').addEventListener('click', cancelOperation);
$('stop-vm').addEventListener('click', cancelOperation);
$('native-abi').addEventListener('change', populateNativeLibraries);
$('inspect-native-button').addEventListener('click', inspectSelectedNative);
$('reopen-file').addEventListener('click', () => { if (state.currentSource) importSource(state.currentSource); });
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
initCollapsibleSections($('control-panel')); initHelpTips($('control-panel'));   // all sections collapsed; long explanations behind "?" icons (src/help-tips.js)
initDeepLinkPanel();
