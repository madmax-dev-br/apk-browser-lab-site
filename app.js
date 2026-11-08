import { APKWorkerClient } from './apk-worker-client.js?v=967d9272d044';
import { layoutBoundsRects, drawLayoutBounds } from './layout-bounds.js?v=967d9272d044';
import { loadDeviceSettings, saveDeviceSettings, sanitizeSettings, defaultDeviceSettings, resolveDevice } from './device-settings.js?v=967d9272d044';
import { MEMORY_STEPS_MIB, memoryBudget } from './memory-budget.js?v=967d9272d044';
import { createDeviceView, createViewState } from './device-view.js?v=967d9272d044';
import { buildDiagnosticReport, causeOf } from './diagnostic-report.js?v=967d9272d044';
import { formatApiGapReport } from './api-gap-scan.js?v=967d9272d044';
import { createLogcatPanel } from './logcat-panel.js?v=967d9272d044';
import { createNetlogPanel, addAllowedHost } from './netlog-panel.js?v=967d9272d044';
import { buildDeepLinkRequest, addToHistory, historyLabel, loadHistory, saveHistory, describeDeepLink } from './deep-link-panel.js?v=967d9272d044';
const apkVM = new APKWorkerClient();
const $ = (id) => document.getElementById(id);
const state = { mode: 'apk', runtime: null, inventory: null, apkRunning: false, canGoBack: false, busy: false, trace: [], composeStarted: false, composeReady: false, composeTimer: null, catalogLoading: false, currentSource: null, launchAttempted: false, operation: 0, operationTimer: null, abortController: null, lastAPKError: null, ...createViewState() };
const params = new URLSearchParams(location.search);
if (params.get('embed') === '1') document.body.classList.add('is-embedded');

function notifyParent(type, data = {}) {
  if (window.parent !== window) window.parent.postMessage({ type, ...data }, location.origin);
}
function setStatus(message, kind = '') {
  $('status-text').textContent = message;
  $('status-dot').className = kind;
  notifyParent('apk-lab-state', { mode: state.mode, status: message, running: kind === 'ok' });
}
function setBusy(busy) {
  state.busy = busy;
  $('activity-select').disabled = busy;
  $('run-button').disabled = busy || !state.runtime || !!state.inventory?.unsupportedFeatures?.length;
  $('stop-vm').hidden = !busy && !apkVM.worker;
  $('back-button').disabled = busy || !state.runtime || !state.canGoBack;
  $('demo-button').disabled = busy;
  $('apk-file').disabled = busy;
  $('reopen-file').disabled = busy;
  $('inspect-native-button').disabled = busy || !state.runtime;
  if ($('clear-app-data')) $('clear-app-data').disabled = busy || !state.runtime;
  $('native-abi').disabled = busy; $('native-library').disabled = busy;
  document.querySelectorAll('[data-inspect-apk]').forEach((button) => { button.disabled = busy || button.dataset.available === 'false'; });
  $('run-button').querySelector('kbd').textContent = busy ? '…' : 'RUN';
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
  state.errorReport = buildDiagnosticReport({ error, packageName: inventory?.packageName ?? state.fileName ?? 'APK', tolerateMissing: $('tolerate-missing')?.value ?? 'off', build: document.querySelector?.('script[src*="app.js"]')?.src?.split('v=')[1] ?? '' }).text;
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
  state.lastAPKError = { error, title };
  state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  $('android-content').inert = true; $('android-window-layer').inert = true;
  if (error.navigation) state.canGoBack = !!error.navigation.canGoBack;
  if (!apkVM.worker) { state.runtime = null; state.apkRunning = false; $('android-device').hidden = true; }
  $('back-button').hidden = state.mode !== 'apk' || !state.canGoBack;
  $('back-button').disabled = state.busy || !state.runtime || !state.canGoBack;
  if (state.mode === 'apk') showError(error, title);
  else appendTrace(`ERRO APK: ${error.message || error}`);
}
// Boot screen: the phone frame appears in the click's own frame (before the Worker answers), shows the phase text, and fades out when the first real frame is drawn (or the operation ends without one).
function sizeBootOverlay() {
  const stage = $('preview-stage'), overlay = $('boot-overlay'); if (!stage || !overlay) return;
  const d = resolveDevice(deviceState.settings), w = d.widthDp, h = d.heightDp, scale = Math.min(0.7, Math.max(120, stage.clientWidth - 24) / (w + 10), Math.max(160, stage.clientHeight - 16) / (h + 10));
  overlay.style.setProperty('--boot-w', String(w)); overlay.style.setProperty('--boot-h', String(h)); overlay.style.setProperty('--boot-scale', scale.toFixed(4));
}
function showBoot(caption) {
  const overlay = $('boot-overlay'); if (!overlay) return;
  clearTimeout(state.bootTimer); sizeBootOverlay(); $('boot-caption').textContent = caption; overlay.classList.remove('fading', 'idle'); overlay.hidden = false; $('empty-preview').hidden = true; state.bootVisible = true;
}
function hideBoot({ force = false } = {}) {
  const overlay = $('boot-overlay'); if (!overlay || !state.bootVisible) return;
  // An APK that is loaded but not running keeps the phone frame on screen, idle, with the one thing the user can do next; the frame only goes away when the app
  // draws its first frame (force) or when there is no APK (an error, a closed file).
  if (!force && state.currentSource && !state.apkRunning && !state.lastAPKError && state.mode === 'apk') { overlay.classList.add('idle'); overlay.classList.remove('fading'); $('boot-caption').textContent = 'APK pronto. Clique em Executar APK para iniciar.'; $('empty-preview').hidden = true; return; }
  state.bootVisible = false; overlay.classList.add('fading'); overlay.classList.remove('idle'); clearTimeout(state.bootTimer);
  state.bootTimer = setTimeout(() => { overlay.hidden = true; overlay.classList.remove('fading'); if (!state.apkRunning && state.mode === 'apk') $('empty-preview').hidden = false; }, 380);
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
function onWorkerProgress(progress = {}) {
  const phases = { 'framework-resources': 'Carregando dados originais de estilos Android', framework: 'Carregando código AOSP compilado', manifest: 'Lendo o manifesto', dex: 'Inspecionando DEX', native: 'Inventariando bibliotecas nativas', complete: 'Inspeção concluída', launch: 'Tentando iniciar a Activity', intent: 'Abrindo o link', click: 'Executando callback DEX', back: 'Retornando à Activity anterior', resources: 'Lendo recursos e layouts XML' };
  const message = `${phases[progress.phase] || 'Processando no Worker'}${progress.filename ? ` · ${progress.filename}` : ''}`;
  $('operation-message').textContent = message; if (state.bootVisible) $('boot-caption').textContent = message;
  const bar = $('operation-progress');
  if (progress.total > 0) { bar.max = progress.total; bar.value = progress.completed || 0; }
  else bar.removeAttribute('value');
  if (state.mode === 'apk') setStatus(message);
}
function cancelOperation() {
  ++state.operation; state.abortController?.abort(); apkVM.cancel(); state.apiGaps = null;
  state.viewSession++; resetWebViews(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear(); state.runtime = null; state.apkRunning = false; state.canGoBack = false; $('back-button').hidden = true; state.lastAPKError = null;
  clearInterval(state.operationTimer); $('operation-panel').hidden = true;
  $('android-device').hidden = true; $('empty-preview').hidden = state.mode !== 'apk';
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
const logcatPanel = createLogcatPanel({ root: $('logcat'), getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app' });   // src/logcat-panel.js
apkVM.onLogcat = message => logcatPanel.push(message);
const netlogPanel = createNetlogPanel({ root: $('netlog'), getPackage: () => state.inventory?.packageName ?? state.fileName ?? 'app', getAllowedHosts: () => deviceState.settings.network.allowedHosts,
  allowHost: host => { if ($('dev-hosts-all').checked) return; $('dev-hosts').value = addAllowedHost($('dev-hosts').value, host); $('dev-hosts').dispatchEvent(new Event('input')); } });   // src/netlog-panel.js; "Permitir" types the host into the Dispositivo field, the same path as typing it
apkVM.onNetlog = message => netlogPanel.push(message);
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
  $('inspection-badge').textContent = inventory.inspectionComplete === false ? 'INSPEÇÃO PARCIAL' : inventory.compose ? 'COMPOSE APK' : 'ANALISADO';
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
  state.currentSource = source; state.launchAttempted = false; state.lastAPKError = null; state.viewSession++; resetWebViews(); for (const id of ['android-content', 'android-window-layer']) for (const child of [...($(id)?.children || [])]) child.remove(); state.viewElements.clear(); state.shadowElements.clear(); state.windowSurfaceElements.clear(); $('android-window-layer')?.replaceChildren?.(); state.composeElements.clear(); state.nativeOverlayElements.clear(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear();
  switchMode('apk'); hideError(); state.runtime = null; state.inventory = null; state.apkRunning = false; state.canGoBack = false; $('back-button').hidden = true;
  $('empty-preview').querySelector('h2').textContent = 'Seu aplicativo começa aqui.'; $('empty-preview').querySelector('p').innerHTML = 'Selecione um APK e clique em Executar.<br>Ou rode a demonstração para testar.';
  showBoot('Abrindo o APK…'); const token = beginOperation('Lendo o arquivo APK…');
  $('native-inspection').hidden = true; $('native-result').hidden = true; $('unsupported-notice').hidden = true; $('inventory').hidden = true; $('inventory-empty').hidden = false; $('inspection-badge').textContent = 'ANALISANDO';
  $('file-info').hidden = false; $('file-name').textContent = source.name; $('file-size').textContent = source.file ? `${formatSize(source.file.size)} · arquivo local` : 'APK de teste hospedado localmente';
  $('reopen-file').hidden = false; $('preview-name').textContent = source.name;
  $('android-device').hidden = true; $('empty-preview').hidden = false;
  state.trace = []; appendTrace(`Abrindo ${source.name} em Web Worker isolado. Sem upload.`);
  setStatus('Lendo o arquivo APK…');
  try {
    let buffer;
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
    $('file-size').textContent = `${formatSize(buffer.byteLength)} · processado no navegador`;
    state.apiGaps = null;
    const result = await apkVM.load(buffer, { onProgress: onWorkerProgress, device: deviceState.settings, tolerateMissing: $('tolerate-missing')?.value ?? 'off', strictCrash: $('strict-crash')?.checked === true, keepData: $('keep-app-data')?.checked !== false, memoryMiB: deviceState.settings.memoryMiB }); state.loadedMemoryMiB = deviceState.settings.memoryMiB; updateVmMemoryHint(); // Ownership transfers to the Worker.
    if (token !== state.operation) return;
    state.runtime = apkVM; state.inventory = result.inventory; showAppData(result.appData);
    showInventory(result.inventory);
    appendTrace(`Pacote: ${result.inventory.packageName || '(não identificado)'}`);
    if (state.mode === 'apk') {
      setStatus(result.inventory.unsupportedFeatures?.length ? 'Arquivo inspecionado · veja os limites de arquivo' : 'Inspecionado · tentativa de execução disponível', result.inventory.unsupportedFeatures?.length ? 'error' : '');
      $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = `<span></span> ${result.inventory.unsupportedFeatures?.length ? 'LIMITE DE ARQUIVO' : 'INSPECIONADO'}`;
    }
  } catch (error) {
    if (token !== state.operation) return;
    $('inspection-badge').textContent = 'ERRO'; reportAPKError(error, 'Não foi possível inspecionar o APK');
  } finally { finishOperation(token); }
  if (token === state.operation && autoRun && state.runtime && !state.inventory?.unsupportedFeatures?.length) await runAPK();
}
async function chooseFile(file) {
  if (!file || state.busy) return;
  if (file.size > 1024 * 1024 * 1024) { switchMode('apk'); showError(new Error('O limite deste laboratório é 1 GiB por APK. Escolha um arquivo menor para continuar.'), 'APK acima do limite de tamanho'); return; }
  if (!/\.apk$/i.test(file.name)) { switchMode('apk'); showError(new Error('Escolha um arquivo com a extensão .apk.'), 'Formato de arquivo inválido'); return; }
  await importSource({ file, name: file.name });
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
  const canvas = $('layout-bounds-canvas'); if (!canvas) return;
  const on = !!deviceState.settings.layoutBounds && !!state.lastSnapshot; canvas.hidden = !on; if (!on) return;
  const screen = $('android-screen'), frame = deviceState.bars?.contentFrame, width = screen.clientWidth || deviceState.bars?.widthDp || 411, height = screen.clientHeight || deviceState.bars?.heightDp || 914;
  drawLayoutBounds(canvas, layoutBoundsRects(state.lastSnapshot, { origin: { x: frame?.left ?? 0, y: frame?.top ?? 0 } }), width, height);
}
const deviceState = { settings: loadDeviceSettings(), clockTimer: null };
const deviceView = createDeviceView({ $, state, deviceState, hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, notifyParent, clickView: id => clickView(id), hooks: {
  navigationChanged(canGoBack) { $('back-button').disabled = state.busy || !canGoBack; $('back-button').hidden = state.mode !== 'apk' || !canGoBack; },
  closed() {
    $('empty-preview').hidden = state.mode !== 'apk';
    $('empty-preview').querySelector('h2').textContent = 'Activity encerrada.'; $('empty-preview').querySelector('p').textContent = 'A pilha de Activities está vazia. Reabra o APK para iniciar uma nova execução.';
    if (state.mode === 'apk') { setStatus('Aplicativo encerrado · nenhuma Activity ativa'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> ENCERRADO'; }
  },
  rendered(snapshot, composeReady) {
    hideBoot({ force: true }); $('empty-preview').hidden = true; updateMemoryMeter(snapshot.vmHealth); state.lastSnapshot = snapshot; redrawLayoutBounds(); if (snapshot.vmHealth) state.lastVmHealth = snapshot.vmHealth;
    if (snapshot.droppedEvent) appendTrace(`Evento descartado: a View ${snapshot.droppedEvent.id} (${snapshot.droppedEvent.type}) já não existe na VM.`);
    // The VM raised java.lang.OutOfMemoryError (even if the app caught it): never silent.
    if ((snapshot.vmHealth?.oomCount ?? 0) > (state.oomSeen ?? 0)) { state.oomSeen = snapshot.vmHealth.oomCount; appendTrace(`OutOfMemoryError: ${snapshot.vmHealth.lastOom?.reason} (${snapshot.vmHealth.liveObjects} objetos vivos)`); setStatus(`java.lang.OutOfMemoryError na VM (${snapshot.vmHealth.liveObjects} objetos vivos, limite ${snapshot.vmHealth.limit})`, 'error'); }
    if (state.mode === 'apk') { $('runtime-badge').className = 'runtime-badge running'; $('runtime-badge').innerHTML = '<span></span> EM EXECUÇÃO'; $('preview-name').textContent = snapshot.activityName?.split('.').pop() || state.inventory?.packageName || 'APK local'; if (composeReady === false) { $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> INICIALIZADO'; setStatus('Activity iniciada · composição ainda sem conteúdo acessível e desenhado'); } else setStatus('Activity em execução · interaja com a interface', 'ok'); }
  },
} });
const { renderSnapshot, flushPendingInputs, updateSystemBarIcons } = deviceView; deviceView.bindVM(apkVM);
// ---- Virtual device settings panel ("Dispositivo virtual") ----
const DEVICE_LOCALES = [['en-US', 'English (US)'], ['pt-BR', 'Português (Brasil)'], ['es-ES', 'Español (España)'], ['fr-FR', 'Français (France)'], ['de-DE', 'Deutsch'], ['ja-JP', '日本語'], ['ar-SA', 'العربية (RTL)'], ['he-IL', 'עברית (RTL)']];
const DEVICE_ZONES = [['', 'Seguir o navegador'], ['America/Sao_Paulo', 'São Paulo (UTC−3)'], ['UTC', 'UTC'], ['America/New_York', 'Nova York'], ['Europe/London', 'Londres'], ['Europe/Paris', 'Paris'], ['Asia/Kolkata', 'Índia (UTC+5:30)'], ['Asia/Tokyo', 'Tóquio'], ['Australia/Sydney', 'Sydney']];
const DEVICE_SCREENS = [['phone', 'Telefone · 411 × 914 dp'], ['compact', 'Compacto · 360 × 800 dp'], ['large', 'Grande · 412 × 892 dp'], ['small', 'Pequeno · 320 × 640 dp'], ['tablet', 'Tablet · 800 × 1280 dp']];
const fillSelect = (select, entries) => { select.replaceChildren(...entries.map(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; })); };
function writeDevicePanel(settings) {
  $('dev-screen').value = settings.screen; $('dev-orientation').value = settings.orientation; $('dev-font').value = String(settings.fontScale); $('dev-font-out').textContent = `${settings.fontScale.toFixed(2).replace('.', ',')}×`;
  $('dev-locale').value = settings.locale; $('dev-dark').checked = settings.darkTheme; $('dev-animator').value = String(settings.animatorScale); $('dev-hour24').checked = settings.hour24; $('dev-tz').value = settings.timeZone;
  $('dev-battery').value = String(settings.battery.level); $('dev-battery-out').textContent = `${settings.battery.level}%`; $('dev-charging').checked = settings.battery.charging; $('dev-network').value = settings.connectivity; $('dev-nav').value = settings.navigation; { const all = settings.network.allowedHosts.includes('*'); $('dev-hosts-all').checked = all; $('dev-hosts').disabled = all; $('dev-hosts').value = all ? '*' : settings.network.allowedHosts.join(', '); } $('dev-layout-bounds').checked = !!settings.layoutBounds; $('dev-proxy').value = settings.network.proxyUrl; if ($('vm-memory')) $('vm-memory').value = String(settings.memoryMiB);
  const device = resolveDevice(settings); $('device-summary').textContent = `${device.widthDp} × ${device.heightDp} · ${settings.orientation === 'landscape' ? 'paisagem' : 'retrato'}`;
}
function readDevicePanel() {
  return sanitizeSettings({ screen: $('dev-screen').value, orientation: $('dev-orientation').value, fontScale: Number($('dev-font').value), locale: $('dev-locale').value, darkTheme: $('dev-dark').checked, animatorScale: Number($('dev-animator').value),
    hour24: $('dev-hour24').checked, timeZone: $('dev-tz').value, battery: { level: Number($('dev-battery').value), charging: $('dev-charging').checked }, connectivity: $('dev-network').value, navigation: $('dev-nav').value, layoutBounds: $('dev-layout-bounds').checked, network: { allowedHosts: $('dev-hosts-all').checked ? ['*'] : $('dev-hosts').value.split(/[\s,]+/).filter(host => host !== '*'), proxyUrl: $('dev-proxy').value }, memoryMiB: Number($('vm-memory')?.value ?? 0) });
}
// "Memória da VM": the Java heap budget (object limit) used at the next load; the VM limit of each step is memoryBudget({ override }).maxHeapObjects, the same rule the Worker applies (heapLimitFor).
const vmMemoryLabel = mibValue => { const { maxHeapObjects } = memoryBudget({ override: mibValue }); return `${mibValue >= 1024 ? `${mibValue / 1024} GiB` : `${mibValue} MiB`} · ${maxHeapObjects.toLocaleString('pt-BR')} objetos`; };
function initVmMemory() {
  const select = $('vm-memory'); if (!select) return;
  const auto = memoryBudget({ deviceMemory: globalThis.navigator?.deviceMemory ?? null });
  fillSelect(select, [['0', `Automático (padrão) · ${auto.budgetMiB} MiB · ${auto.maxHeapObjects.toLocaleString('pt-BR')} objetos`], ...MEMORY_STEPS_MIB.map(value => [String(value), vmMemoryLabel(value)])]);
  const device = globalThis.navigator?.deviceMemory; $('vm-memory-device').textContent = device != null ? `Este navegador informa ${device} GiB de memória no dispositivo.` : 'Este navegador não informa a memória do dispositivo.';
}
// The hint shows while a loaded APK was opened with another budget than the one selected now (the budget is read by `load`, never applied live).
function updateVmMemoryHint() { const hint = $('vm-memory-hint'); if (hint) hint.hidden = !(apkVM.worker && state.loadedMemoryMiB !== undefined && state.loadedMemoryMiB !== deviceState.settings.memoryMiB); }
let deviceApplying = Promise.resolve();
function applyDeviceSettings(settings) {
  deviceState.settings = settings; updateVmMemoryHint(); saveDeviceSettings(settings); writeDevicePanel(settings); updateSystemBarIcons(); redrawLayoutBounds();
  const note = $('device-status');
  if (state.runtime !== apkVM || !state.apkRunning) { note.textContent = 'Nenhum app em execução: as configurações valem desde o próximo lançamento.'; return deviceApplying; }
  // One RPC at a time: wait for a VM operation in flight, then deliver the newest settings through ActivityThread semantics.
  deviceApplying = deviceApplying.then(async () => {
    for (let attempt = 0; attempt < 100 && apkVM.pending; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    const latest = deviceState.settings;
    try {
      const { outcome, snapshot } = await apkVM.setDevice(latest);
      if (snapshot) renderSnapshot(snapshot);
      note.textContent = outcome?.changed ? `Aplicado ao vivo: ${outcome.relaunched ? `${outcome.relaunched} Activity recriada(s) com estado salvo` : ''}${outcome.relaunched && outcome.delivered ? ' · ' : ''}${outcome.delivered ? `${outcome.delivered} onConfigurationChanged` : ''}${!outcome.relaunched && !outcome.delivered ? 'sem mudança de Configuration (barra de status, rede/bateria/fuso)' : ''}.` : 'Sem alteração para o app.';
    } catch (error) { note.textContent = 'O app não aceitou a mudança: ' + (error?.message || error); reportAPKError(error, 'Mudança de configuração do dispositivo interrompida'); }
  });
  return deviceApplying;
}
function initDevicePanel() {
  fillSelect($('dev-screen'), DEVICE_SCREENS); fillSelect($('dev-locale'), DEVICE_LOCALES); fillSelect($('dev-tz'), DEVICE_ZONES); initVmMemory(); writeDevicePanel(deviceState.settings);
  for (const id of ['dev-screen', 'dev-orientation', 'dev-font', 'dev-locale', 'dev-dark', 'dev-animator', 'dev-hour24', 'dev-tz', 'dev-battery', 'dev-charging', 'dev-network', 'dev-nav', 'dev-hosts-all', 'dev-layout-bounds', 'dev-hosts', 'dev-proxy', 'vm-memory']) $(id).addEventListener('input', () => { applyDeviceSettings(readDevicePanel()); });
  document.querySelector('#trace .trace-actions')?.addEventListener('click', event => event.preventDefault());   // buttons in the <summary> must not toggle the panel
  $('device-reset').addEventListener('click', () => { applyDeviceSettings(defaultDeviceSettings()); });
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
    await flushPendingInputs(); switchMode('apk'); hideError(); state.lastAPKError = null;
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
  if (!state.runtime || state.busy || state.runStarting) return;
  state.runStarting = true; showBoot('Iniciando o aplicativo…');
  try { await runAPKOnce(); } finally { state.runStarting = false; }
}
async function runAPKOnce() {
  await flushPendingInputs();
  const activity = $('activity-select').value || undefined;
  if (state.launchAttempted) {
    const source = state.currentSource;
    if (!source) return;
    await importSource(source);
    if (!state.runtime || state.busy) return;
    if (activity && [...$('activity-select').options].some(option => option.value === activity)) $('activity-select').value = activity;
  }
  switchMode('apk'); hideError(); state.lastAPKError = null; state.launchAttempted = true;
  const token = beginOperation('Tentando iniciar a Activity…');
  state.runStartedAt = Date.now(); try { const snapshot = await state.runtime.launch(activity, { onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
  catch (error) { if (token === state.operation) reportAPKError(error); }
  finally { finishOperation(token); }
}
async function backAPK() {
  if (!state.runtime || state.busy || !state.canGoBack) return;
  await flushPendingInputs(); hideError(); const token = beginOperation('Retornando à Activity anterior…');
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
  if (state.busy) return;
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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.scenarios)) throw new Error('Formato de catálogo inválido');
    const cards = catalog.scenarios.map((entry) => {
      // The catalog names packaged fixtures; it never supplies runtime data or behavior.
      if (!/^[a-z0-9-]+\.apk$/i.test(entry.file)) throw new Error('Nome de APK inválido no catálogo');
      const available = entry.available !== false;
      const card = document.createElement('article'); card.className = 'scenario-card';
      const top = document.createElement('div'); top.className = 'scenario-card-top';
      const icon = document.createElement('span'); icon.className = 'scenario-file-icon'; icon.textContent = 'APK';
      const badge = document.createElement('span'); badge.className = `scenario-badge${entry.executionValidated ? ' supported' : ''}`;
      badge.textContent = available ? entry.executionValidated ? 'EXECUÇÃO VALIDADA' : 'TENTATIVA EXPERIMENTAL' : 'EM BUILD';
      top.append(icon, badge);
      const title = document.createElement('h3'); title.textContent = entry.title;
      const description = document.createElement('p'); description.textContent = entry.description;
      const tags = document.createElement('div'); tags.className = 'scenario-tags';
      (entry.tags || []).forEach((text) => { const tag = document.createElement('span'); tag.textContent = text; tags.append(tag); });
      const file = document.createElement('div'); file.className = 'scenario-filename'; file.textContent = `${entry.file}${entry.sizeBytes ? ` · ${formatSize(entry.sizeBytes)}` : ''}`;
      const actions = document.createElement('div'); actions.className = 'scenario-actions';
      const inspect = document.createElement('button'); inspect.type = 'button'; inspect.textContent = 'Inspecionar';
      inspect.dataset.inspectApk = entry.id; inspect.dataset.available = String(available); inspect.disabled = state.busy || !available;
      inspect.addEventListener('click', () => inspectCatalogAPK(entry));
      const download = document.createElement('a'); download.textContent = 'Baixar APK ↓';
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
  $('back-button').hidden = !state.canGoBack;
  $('android-device').hidden = !state.apkRunning; $('android-device').inert = false;
  $('empty-preview').hidden = state.apkRunning;
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
$('drop-zone').addEventListener('drop', (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); chooseFile(event.dataTransfer.files?.[0]); });
$('run-button').addEventListener('click', runAPK);
$('back-button').addEventListener('click', backAPK);
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
loadScenarioCatalog();
notifyParent('apk-lab-ready');
if (params.get('demo') === '1') runDemo();
initDevicePanel();
initDeepLinkPanel();
