import { APKWorkerClient } from './apk-worker-client.js?v=5c4318daa7f6';
import { loadDeviceSettings, saveDeviceSettings, sanitizeSettings, resolveDevice } from './device-settings.js?v=5c4318daa7f6';
import { createDeviceView, createViewState } from './device-view.js?v=5c4318daa7f6';
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
function hideError() { $('error-panel').hidden = true; }
function showError(error, title = 'Tentativa de execução interrompida') {
  const inventory = state.mode === 'apk' ? state.inventory : null;
  const raw = error?.message || String(error);
  $('error-title').textContent = /JNI|native method|native library/i.test(raw) ? 'Limite de execução nativa' : title;
  const cause = raw.replace(/^(?:L[^\n]+? \[[^\]\n]+\] at PC 0x[\da-f]+: )+/i, '');
  $('error-message').textContent = cause.length > 800 ? '…' + cause.slice(-800) : cause;
  const details = [...(inventory?.unsupportedFeatures || [])];
  if (cause !== raw || cause.length > 800) details.push('Pilha de chamadas:\n' + raw);
  if (error.details) details.push(typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2));
  if (error.trace?.length) details.push('Últimas instruções da VM:\n' + error.trace.slice(-40).join('\n'));
  $('error-detail').textContent = [...new Set(details)].join('\n');
  $('error-detail').hidden = !details.length;
  $('error-diagnostics').hidden = !details.length;
  $('error-diagnostics').open = false;
  $('error-compose').hidden = !inventory?.compose;
  $('error-panel').hidden = false;
  $('runtime-badge').className = 'runtime-badge';
  $('runtime-badge').innerHTML = '<span></span> INTERROMPIDO';
  setStatus('Tentativa interrompida · diagnóstico real da VM', 'error');
  appendTrace(`ERRO: ${raw}`);
}
function reportAPKError(error, title) {
  state.lastAPKError = { error, title };
  state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0;
  $('android-content').inert = true; $('android-window-layer').inert = true;
  if (error.navigation) state.canGoBack = !!error.navigation.canGoBack;
  if (!apkVM.worker) { state.runtime = null; state.apkRunning = false; $('android-device').hidden = true; }
  $('back-button').hidden = state.mode !== 'apk' || !state.canGoBack;
  $('back-button').disabled = state.busy || !state.runtime || !state.canGoBack;
  if (state.mode === 'apk') showError(error, title);
  else appendTrace(`ERRO APK: ${error.message || error}`);
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
  clearInterval(state.operationTimer); $('operation-panel').hidden = true; state.abortController = null; setBusy(false); if (state.pendingInputs.size || state.pendingFocus.length || state.pendingComposeActions.length || state.pendingScrolls.size || state.pendingPointers.length) flushPendingInputs();
}
function onWorkerProgress(progress = {}) {
  const phases = { 'framework-resources': 'Carregando dados originais de estilos Android', framework: 'Carregando código AOSP compilado', manifest: 'Lendo o manifesto', dex: 'Inspecionando DEX', native: 'Inventariando bibliotecas nativas', complete: 'Inspeção concluída', launch: 'Tentando iniciar a Activity', click: 'Executando callback DEX', back: 'Retornando à Activity anterior', resources: 'Lendo recursos e layouts XML' };
  const message = `${phases[progress.phase] || 'Processando no Worker'}${progress.filename ? ` · ${progress.filename}` : ''}`;
  $('operation-message').textContent = message;
  const bar = $('operation-progress');
  if (progress.total > 0) { bar.max = progress.total; bar.value = progress.completed || 0; }
  else bar.removeAttribute('value');
  if (state.mode === 'apk') setStatus(message);
}
function cancelOperation() {
  ++state.operation; state.abortController?.abort(); apkVM.cancel();
  state.viewSession++; state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.runtime = null; state.apkRunning = false; state.canGoBack = false; $('back-button').hidden = true; state.lastAPKError = null;
  clearInterval(state.operationTimer); $('operation-panel').hidden = true;
  $('android-device').hidden = true; $('empty-preview').hidden = state.mode !== 'apk';
  setBusy(false);
  if (state.mode === 'apk') { hideError(); setStatus('VM encerrada · reabra o APK para continuar'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> CANCELADO'; }
}
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
  $('unsupported-compose').hidden = !inventory.compose;
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
  if (inventory.resourceSummary) details.append(listSection('RECURSOS ANDROID', [`${inventory.resourceSummary.entries} recursos · ${inventory.resourceSummary.parsedLayouts}/${inventory.resourceSummary.layoutFiles} layouts XML preparados`, ...(inventory.resourceSummary.errors || [])]));
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
  state.currentSource = source; state.launchAttempted = false; state.lastAPKError = null; state.viewSession++; for (const id of ['android-content', 'android-window-layer']) for (const child of [...($(id)?.children || [])]) child.remove(); state.viewElements.clear(); state.shadowElements.clear(); state.windowSurfaceElements.clear(); $('android-window-layer')?.replaceChildren?.(); state.composeElements.clear(); state.nativeOverlayElements.clear(); state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0;
  switchMode('apk'); hideError(); state.runtime = null; state.inventory = null; state.apkRunning = false; state.canGoBack = false; $('back-button').hidden = true;
  $('empty-preview').querySelector('h2').textContent = 'Seu aplicativo começa aqui.'; $('empty-preview').querySelector('p').innerHTML = 'Selecione um APK e clique em Executar.<br>Ou rode a demonstração para testar.';
  const token = beginOperation('Lendo o arquivo APK…');
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
    const result = await apkVM.load(buffer, { onProgress: onWorkerProgress, device: deviceState.settings, tolerateMissing: $('tolerate-missing')?.value ?? 'off' }); // Ownership transfers to the Worker.
    if (token !== state.operation) return;
    state.runtime = apkVM; state.inventory = result.inventory;
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
const deviceState = { settings: loadDeviceSettings(), clockTimer: null };
const deviceView = createDeviceView({ $, state, deviceState, hideError, appendTrace, updateTrace, reportAPKError, beginOperation, finishOperation, notifyParent, clickView: id => clickView(id), hooks: {
  navigationChanged(canGoBack) { $('back-button').disabled = state.busy || !canGoBack; $('back-button').hidden = state.mode !== 'apk' || !canGoBack; },
  closed() {
    $('empty-preview').hidden = state.mode !== 'apk';
    $('empty-preview').querySelector('h2').textContent = 'Activity encerrada.'; $('empty-preview').querySelector('p').textContent = 'A pilha de Activities está vazia. Reabra o APK para iniciar uma nova execução.';
    if (state.mode === 'apk') { setStatus('Aplicativo encerrado · nenhuma Activity ativa'); $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> ENCERRADO'; }
  },
  rendered(snapshot, composeReady) {
    $('empty-preview').hidden = true;
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
  $('dev-battery').value = String(settings.battery.level); $('dev-battery-out').textContent = `${settings.battery.level}%`; $('dev-charging').checked = settings.battery.charging; $('dev-network').value = settings.connectivity; $('dev-nav').value = settings.navigation; $('dev-hosts').value = settings.network.allowedHosts.join(', '); $('dev-proxy').value = settings.network.proxyUrl;
  const device = resolveDevice(settings); $('device-summary').textContent = `${device.widthDp} × ${device.heightDp} · ${settings.orientation === 'landscape' ? 'paisagem' : 'retrato'}`;
}
function readDevicePanel() {
  return sanitizeSettings({ screen: $('dev-screen').value, orientation: $('dev-orientation').value, fontScale: Number($('dev-font').value), locale: $('dev-locale').value, darkTheme: $('dev-dark').checked, animatorScale: Number($('dev-animator').value),
    hour24: $('dev-hour24').checked, timeZone: $('dev-tz').value, battery: { level: Number($('dev-battery').value), charging: $('dev-charging').checked }, connectivity: $('dev-network').value, navigation: $('dev-nav').value, network: { allowedHosts: $('dev-hosts').value, proxyUrl: $('dev-proxy').value } });
}
let deviceApplying = Promise.resolve();
function applyDeviceSettings(settings) {
  deviceState.settings = settings; saveDeviceSettings(settings); writeDevicePanel(settings); updateSystemBarIcons();
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
  fillSelect($('dev-screen'), DEVICE_SCREENS); fillSelect($('dev-locale'), DEVICE_LOCALES); fillSelect($('dev-tz'), DEVICE_ZONES); writeDevicePanel(deviceState.settings);
  for (const id of ['dev-screen', 'dev-orientation', 'dev-font', 'dev-locale', 'dev-dark', 'dev-animator', 'dev-hour24', 'dev-tz', 'dev-battery', 'dev-charging', 'dev-network', 'dev-nav', 'dev-hosts', 'dev-proxy']) $(id).addEventListener('input', () => { applyDeviceSettings(readDevicePanel()); });
  $('device-reset').addEventListener('click', () => { applyDeviceSettings(sanitizeSettings({})); });
}
async function runAPK() {
  if (!state.runtime || state.busy || state.runStarting) return;
  state.runStarting = true;
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
  try { const snapshot = await state.runtime.launch(activity, { onProgress: onWorkerProgress }); if (token === state.operation) renderSnapshot(snapshot); }
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
  if (!state.runtime || state.busy) return;
  await flushPendingInputs(); const token = beginOperation('Executando callback DEX…');
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
function startCompose(reload = false) {
  if (state.composeStarted && !reload) return;
  state.composeStarted = true; state.composeReady = false; $('compose-loading').hidden = false; $('compose-state').hidden = true;
  clearTimeout(state.composeTimer);
  $('compose-frame').src = new URL(`./compose/${reload ? `?reload=${Date.now()}` : ''}`, location.href).href;
  setStatus('Carregando o aplicativo Kotlin/Wasm…');
  state.composeTimer = setTimeout(() => {
    if (state.mode !== 'compose' || $('compose-loading').hidden) return;
    $('compose-loading').hidden = true;
    showError(new Error('O módulo Compose Web ainda não respondeu. Verifique o carregamento dos arquivos Kotlin/Wasm ou tente recarregar o exemplo.'), 'Compose Web não respondeu');
  }, 45000);
}
function switchMode(mode) {
  state.mode = mode;
  const compose = mode === 'compose';
  $('apk-panel').hidden = compose; $('compose-panel').hidden = !compose;
  $('apk-tab').classList.toggle('active', !compose); $('compose-tab').classList.toggle('active', compose);
  $('apk-tab').setAttribute('aria-selected', String(!compose)); $('compose-tab').setAttribute('aria-selected', String(compose));
  $('compose-container').hidden = !compose; $('back-button').hidden = compose || !state.canGoBack;
  $('android-device').hidden = compose || !state.apkRunning;
  $('android-device').inert = compose;
  $('empty-preview').hidden = compose || state.apkRunning;
  hideError();
  $('execution-engine').textContent = compose ? 'KOTLIN / WASM' : '411 × 840 dp · DENSIDADE 1';
  if (compose) {
    $('preview-name').textContent = 'Compose Multiplatform · Web';
    $('runtime-badge').className = 'runtime-badge'; $('runtime-badge').innerHTML = '<span></span> KOTLIN / WASM';
    startCompose();
    if (state.composeReady) { $('runtime-badge').className = 'runtime-badge running'; $('runtime-badge').innerHTML = '<span></span> EM EXECUÇÃO'; setStatus('Compose Web em execução · Kotlin/Wasm', 'ok'); }
    else setStatus('Carregando o aplicativo Kotlin/Wasm…');
  } else {
    $('preview-name').textContent = state.inventory?.packageName || 'Prévia do aplicativo';
    const running = state.apkRunning;
    $('runtime-badge').className = `runtime-badge${running ? ' running' : ''}`;
    $('runtime-badge').innerHTML = `<span></span> ${running ? 'EM EXECUÇÃO' : state.inventory?.unsupportedFeatures?.length ? 'BLOQUEADO' : state.runtime ? 'INSPECIONADO' : 'INATIVO'}`;
    if (state.lastAPKError) { showError(state.lastAPKError.error, state.lastAPKError.title); return; }
    setStatus(running ? 'Activity em execução · interaja com a interface' : state.inventory?.unsupportedFeatures?.length ? 'APK identificado · execução bloqueada por recursos não suportados' : state.runtime ? 'Inspecionado · tentativa de execução disponível' : 'Aguardando um aplicativo', running ? 'ok' : state.inventory?.unsupportedFeatures?.length ? 'error' : '');
  }
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
$('apk-tab').addEventListener('click', () => switchMode('apk'));
$('compose-tab').addEventListener('click', () => switchMode('compose'));
$('open-compose').addEventListener('click', () => switchMode('compose'));
$('error-compose').addEventListener('click', () => switchMode('compose'));
$('unsupported-compose').addEventListener('click', () => switchMode('compose'));
$('compose-phone').addEventListener('click', () => { $('preview-stage').classList.add('compose-phone'); $('compose-phone').setAttribute('aria-pressed', 'true'); $('compose-wide').setAttribute('aria-pressed', 'false'); });
$('compose-wide').addEventListener('click', () => { $('preview-stage').classList.remove('compose-phone'); $('compose-phone').setAttribute('aria-pressed', 'false'); $('compose-wide').setAttribute('aria-pressed', 'true'); });
$('reload-compose').addEventListener('click', () => { hideError(); startCompose(true); });
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
  if (event.source === $('compose-frame').contentWindow) {
    if (event.data.type === 'compose-ready') {
      state.composeReady = true; clearTimeout(state.composeTimer); $('compose-loading').hidden = true;
      if (state.mode === 'compose') { hideError(); $('runtime-badge').className = 'runtime-badge running'; $('runtime-badge').innerHTML = '<span></span> EM EXECUÇÃO'; setStatus('Compose Web em execução · Kotlin/Wasm', 'ok'); }
      appendTrace('Compose Web: módulo Kotlin/Wasm iniciado.');
    }
    if (event.data.type === 'feature-state' && Number.isFinite(event.data.count)) {
      $('compose-state').hidden = false; $('compose-count').textContent = `count = ${event.data.count}`;
      $('compose-request').textContent = typeof event.data.request === 'string' ? event.data.request : JSON.stringify(event.data.request ?? '');
      appendTrace(`Compose Web: count=${event.data.count}`); notifyParent('apk-lab-compose-state', { count: event.data.count, request: event.data.request });
    }
  } else if (event.source === window.parent && window.parent !== window) {
    if (event.data.type === 'apk-lab-run-demo') runDemo();
    if (event.data.type === 'apk-lab-switch-mode' && ['apk', 'compose'].includes(event.data.mode)) switchMode(event.data.mode);
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
if (params.get('mode') === 'compose') switchMode('compose');
else if (params.get('demo') === '1') runDemo();
initDevicePanel();
