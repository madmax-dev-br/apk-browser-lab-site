// Message-driven controller of one player frame. DOM-free: the VM client, the shared device view and the postMessage sink are injected, so the
// same code runs in the real frame (frame.js) and in the headless tests.
//
// Every lab feature goes through the APKWorkerClient call the test page (src/app.js and its panels) makes, with the same arguments, after the same sanitizer:
// device settings -> setDevice, "Tempo máximo por evento" -> setTimeLimits, "Retornos de métodos" -> setMethodOverrides, "Activities ignoradas" -> setIgnoredActivities,
// "Mock de endpoints" -> setEndpointMocks, "Permissões" / location / dialog -> setPermissions + permissionResponse, "Abrir" -> startIntent, Logcat -> setLogcatStreaming,
// Compose -> inspectCompose, plugins -> src/plugin-host.js. The host page is another origin: everything it sends is validated here before it reaches the VM.
import { configToSettings, parseConfig, settingsToConfig, labConfigOf, describeError, envelope, stubListsFromSnapshot, MAX_APK_BYTES, DEVICE_KEYS, STREAMS, PERMISSION_DIALOG } from './protocol.js?v=59a9b4dd227f';
import { buildDiagnosticReport } from '../diagnostic-report.js?v=59a9b4dd227f';
import { formatApiGapReport } from '../api-gap-scan.js?v=59a9b4dd227f';
import { sanitizeSettings, deviceForVM } from '../device-settings.js?v=59a9b4dd227f';
import { normalizeMock, validateMock } from '../endpoint-mocks.js?v=59a9b4dd227f';
import { parseMethodSpec } from '../method-overrides.js?v=59a9b4dd227f';
import { sanitizeConfig as sanitizePermissionConfig, answerDialog, emptyConfig } from '../runtime-permissions.js?v=59a9b4dd227f';
import { normalizeIntentRequest } from '../intent-resolver.js?v=59a9b4dd227f';
import { buildDeepLinkRequest, describeDeepLink, DEFAULT_ACTION } from '../deep-link-panel.js?v=59a9b4dd227f';
import { buildLayoutBoundsElements } from '../compose-inspector-panel.js?v=59a9b4dd227f';
import { screenFromSnapshot, screenKey, layoutBoundsElementOut, MAX_LOG_BATCH } from '../plugin-host.js?v=59a9b4dd227f';
import { normalizePlugin, validatePlugin, MAX_PLUGINS } from '../plugin-store.js?v=59a9b4dd227f';
import { rowToEntry } from '../logcat.js?v=59a9b4dd227f';
import { parseRule, describeRule, ruleKey, hitText } from '../host-map.js?v=59a9b4dd227f';

export const SCREENSHOT_GAP_MS = 250, PLUGIN_OUTPUT_MS = 100, MAX_STREAM_BATCH = MAX_LOG_BATCH;
const LAB_LIVE = ['methodOverrides', 'ignoredActivities', 'endpointMocks', 'permissions', 'location', 'permissionDialog'];
const callError = (code, message) => Object.assign(new Error(message), { code });
const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shortText = (value, max, what) => { if (value === undefined || value === null) return undefined; if (typeof value !== 'string' || value.length > max) throw callError('bad-args', `${what} must be a string of at most ${max} characters`); return value; };

/**
 * @param createPluginHost (callbacks) -> a src/plugin-host.js host; called once, on the first plugins call (the frame passes one bound to its VM and screen capture)
 * @param captureImage     ({ snapshot, element, maxWidth, type }) -> Promise<{ blob, width, height, notes }> (src/screen-capture.js bound to the frame's views)
 * @param hooks            error, interrupted, settingsChanged, destroyed, rendered(snapshot, settings) (layout bounds overlay), permissionDialog(request) -> Promise<answers|null>
 */
export function createFrameController({ vm, state, deviceState, post, fetchImpl = globalThis.fetch?.bind(globalThis), hooks = {}, createPluginHost = null, captureImage = null, now = () => (globalThis.performance?.now?.() ?? Date.now()) }) {
  let view = null, source = null, config = {}, lastActivity = null, destroyed = false, chain = Promise.resolve(), inflight = 0, oomSeen = 0, lastStubs = { void: [], returns: [], classes: [] }, packageName = '', tolerateRunning = 'off'; const dropped = [];
  let lastSnapshot = null, lastScreenKey = null, frameCount = 0, inventory = null, permConfig = emptyConfig(), lastError = null, lastShotAt = -Infinity, loaded = { memoryMiB: 0, strictCrash: false };
  let statuses = { methodOverrides: [], ignoredActivities: [], endpointMocks: [] };
  const subscribed = { logcat: false, network: false, screen: false }; let logcatSent = false;
  let pluginHost = null, pluginTimer = null; const pluginChanged = new Set();
  const pendingPermissions = new Map();
  const send = (type, payload) => post(envelope(type, payload));
  const tolerate = () => config.tolerateMissing ?? 'off';
  const fail = (error, phase) => {
    lastError = error;
    const info = describeError(error, phase, { packageName, tolerateMissing: tolerateRunning });
    if (!error?.stubLists && lastStubs.void.length + lastStubs.returns.length + lastStubs.classes.length) { info.stubs = lastStubs; }   // errors raised outside the Worker (OOM, dropped events) still carry the stubs of the live run
    hooks.error?.(info); send('error', info);
  };
  const diagnostics = id => {
    const { text } = buildDiagnosticReport({ error: { message: 'diagnostics requested (no error)' }, product: 'APK Player', packageName: packageName || 'APK', tolerateMissing: tolerateRunning, stubs: [...lastStubs.void, ...lastStubs.returns, ...lastStubs.classes], apiGaps: vm.apiGaps ? formatApiGapReport(vm.apiGaps) : '' });
    return { id, stubs: lastStubs, tolerateMissing: tolerateRunning, packageName, report: text.slice(0, 65000) };
  };
  const clearPending = () => { state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear(); };
  const enqueue = work => { inflight++; chain = chain.then(() => (destroyed ? undefined : work())).catch(error => fail(error, 'operation')).finally(() => { inflight--; }); return chain; };
  /** Like enqueue, but the caller gets the work's own result or error (calls that answer the host). */
  const serial = work => { inflight++; const result = chain.then(() => { if (destroyed) throw callError('destroyed', 'The player was destroyed.'); return work(); }); chain = result.catch(() => {}).finally(() => { inflight--; }); return result; };
  const waitIdle = async (ms = 5000) => { for (let waited = 0; vm.pending && waited < ms; waited += 25) await new Promise(resolve => setTimeout(resolve, 25)); };   // the VM serves one request at a time
  const running = () => state.runtime === vm && state.apkRunning;
  const applyConfig = patch => {
    const { config: parsed, rejected } = parseConfig(patch);
    if (parsed.endpointMocks) parsed.endpointMocks = parsed.endpointMocks.map(normalizeMock);   // the panel's shape (stable ids for the hit counters)
    const next = { ...config, ...parsed }, { settings, rejected: more } = configToSettings(next);
    config = next; deviceState.settings = settings; return { settings, rejected: [...rejected, ...more], parsed };
  };
  const manifestOf = () => (inventory ? { usesSdk: inventory.usesSdk, usesPermissions: inventory.usesPermissions ?? [], declaredPermissions: inventory.declaredPermissions ?? [] } : {});
  const dialogMode = () => config.permissionDialog ?? 'none';

  // ---- streams (Logcat, network log) and plugins: work only while somebody listens ----------------------------------------------------------------------------------------
  const wantsLogcat = () => subscribed.logcat || !!pluginHost?.wantsLogs;
  /** The Worker streams Logcat rows only while the host subscribed or a running plugin listens to 'log' (src/logcat.js setStreaming); otherwise it posts only a counter. */
  const syncLogcat = (force = false) => {
    const wanted = wantsLogcat(); if (!vm.worker || typeof vm.setLogcatStreaming !== 'function' || (!force && wanted === logcatSent)) return Promise.resolve();
    logcatSent = wanted; return vm.setLogcatStreaming(wanted).catch(() => {});
  };
  const chunks = rows => { const out = []; for (let at = 0; at < rows.length; at += MAX_STREAM_BATCH) out.push(rows.slice(at, at + MAX_STREAM_BATCH)); return out.length ? out : [[]]; };
  vm.onLogcat = message => {
    pluginHost?.logcat(message);
    if (!subscribed.logcat || message?.count) return;
    chunks(Array.isArray(message?.rows) ? message.rows : []).forEach((rows, index) => send('logcat', { entries: rows.map(rowToEntry), reset: index === 0 && !!message.reset, dropped: message.dropped | 0, total: message.total | 0 }));
  };
  vm.onNetlog = message => {
    pluginHost?.netlog(message);
    if (!subscribed.network) return;
    chunks(Array.isArray(message?.rows) ? message.rows : []).forEach((rows, index) => send('network', { entries: rows, reset: index === 0 && !!message.reset, dropped: message.dropped | 0, total: message.total | 0 }));
  };
  const pluginSummary = plugin => ({ id: plugin.id, name: plugin.name, enabled: plugin.enabled, packageFilter: plugin.packageFilter, status: plugin.status, reason: plugin.reason ?? '', badge: plugin.output.badge, blocks: plugin.output.blocks.slice(),
    console: plugin.console.slice(-50).map(line => ({ ...line })), errors: plugin.errors.slice(-20).map(error => ({ ...error })), errorCount: plugin.errorCount });
  const flushPlugins = () => { pluginTimer = null; for (const id of pluginChanged) { const plugin = pluginHost?.get(id); send('plugin-output', { plugin: plugin ? pluginSummary(plugin) : { id, removed: true, blocks: [] } }); } pluginChanged.clear(); };
  function ensurePluginHost() {
    if (pluginHost) return pluginHost;
    if (typeof createPluginHost !== 'function') throw callError('unsupported', 'Plugins are not available in this frame.');
    pluginHost = createPluginHost({ vm, getPackage: () => packageName || null, onChange: id => { pluginChanged.add(id); if (pluginTimer === null) pluginTimer = setTimeout(flushPlugins, PLUGIN_OUTPUT_MS); }, onLogStreaming: () => { syncLogcat(); } });
    if (lastSnapshot) pluginHost.snapshot(lastSnapshot);
    return pluginHost;
  }

  // ---- runtime permissions: the state, the simulated location and the dialog (src/runtime-permissions.js rules, as the "Permissões" panel applies them) ---------------------
  const describeRequest = request => ({ id: request.id, requestCode: request.requestCode ?? null, appLabel: String(request.appLabel ?? ''),
    dialogs: (request.dialogs ?? []).map(dialog => ({ group: String(dialog.group), section: String(dialog.section ?? ''), label: String(dialog.label ?? ''), question: String(dialog.question ?? '').replace('%s', request.appLabel ?? ''), permissions: [...(dialog.permissions ?? [])], oneTime: !!dialog.oneTime })) });
  vm.onPermissionRequest = request => {
    const mode = dialogMode();
    if (mode === 'none' || (mode === 'frame' && typeof hooks.permissionDialog !== 'function')) { vm.permissionResponse(request.id, null); return; }   // dismissed: the VM counts a denial
    permConfig = sanitizePermissionConfig(request.config ?? permConfig);   // the VM's copy is the newest (it may have counted a denial)
    pendingPermissions.set(request.id, request);
    const described = describeRequest(request);
    if (mode === 'host') { send('permission-request', { request: described }); return; }
    Promise.resolve().then(() => hooks.permissionDialog(described)).then(answers => answerPermission(request.id, answers), () => answerPermission(request.id, null));
  };
  vm.onPermissionConfig = next => { permConfig = sanitizePermissionConfig(next); send('permission-config', { config: permConfig }); };
  /** answers: one of 'allow' | 'once' | 'deny' per dialog of the request (or one value for all of them), null = the user dismissed the dialog. */
  function answerPermission(id, answers) {
    const request = pendingPermissions.get(id); if (!request) return false;
    pendingPermissions.delete(id);
    if (answers === null || answers === undefined) { vm.permissionResponse(id, null); return true; }
    let next = sanitizePermissionConfig(request.config ?? permConfig);
    (request.dialogs ?? []).forEach((dialog, index) => { next = answerDialog(next, manifestOf(), dialog, Array.isArray(answers) ? answers[index] : answers); });
    permConfig = next; vm.permissionResponse(id, next); send('permission-config', { config: next });
    return true;
  }

  // ---- the lab lists, pushed to the running VM (at load, before the app runs, and live) ------------------------------------------------------------------------------------
  /** "Retornos de métodos": a Java-form method without a return type takes the APK's only candidate, as the panel completes it (vm.searchMethods); otherwise the VM reports it invalid. */
  async function resolveOverrides(list, rejected) {
    const out = [];
    for (const [index, row] of list.entries()) {
      const spec = parseMethodSpec(row.method);
      if (spec.ok && spec.result === null && typeof vm.searchMethods === 'function') {
        try {
          const { returnTypes } = await vm.searchMethods({ owner: spec.owner, name: spec.name, parameters: spec.parameters });
          if (returnTypes.length === 1) { out.push({ ...row, method: `${spec.owner}->${spec.name}(${spec.parameters.join('')})${returnTypes[0]}` }); continue; }
          rejected.push(`methodOverrides[${index}] (${returnTypes.length ? `more than one return type: ${returnTypes.join(', ')}; write the type` : 'no method with this name and parameters in the APK'})`);
        } catch (error) { rejected.push(`methodOverrides[${index}] (${String(error?.message ?? error).slice(0, 200)})`); }
      }
      out.push(row);
    }
    return out;
  }
  async function pushLab(keys, rejected) {
    if (!vm.worker) return;
    const attempt = async (key, work) => { try { await work(); } catch (error) { rejected.push(`${key} (the VM did not apply it: ${String(error?.message ?? error).slice(0, 200)})`); } };
    if ((keys.has('permissions') || keys.has('location') || keys.has('permissionDialog')) && typeof vm.setPermissions === 'function') {
      const payload = { dialogs: dialogMode() !== 'none' }; if (keys.has('permissions')) payload.config = permConfig; if (keys.has('location')) payload.location = config.location ?? null;
      await attempt('permissions', () => vm.setPermissions(payload));
    }
    if (keys.has('methodOverrides') && typeof vm.setMethodOverrides === 'function') await attempt('methodOverrides', async () => { statuses.methodOverrides = await vm.setMethodOverrides(await resolveOverrides(config.methodOverrides ?? [], rejected)); });
    if (keys.has('ignoredActivities') && typeof vm.setIgnoredActivities === 'function') await attempt('ignoredActivities', async () => { statuses.ignoredActivities = await vm.setIgnoredActivities((config.ignoredActivities ?? []).filter(row => row.name)); });
    if (keys.has('endpointMocks') && typeof vm.setEndpointMocks === 'function') {
      (config.endpointMocks ?? []).forEach((mock, index) => { const { errors } = validateMock(mock); if (errors.length) rejected.push(`endpointMocks[${index}] (${errors.map(error => error.message).join(' ')})`); });
      await attempt('endpointMocks', async () => { statuses.endpointMocks = await vm.setEndpointMocks(config.endpointMocks ?? []); });
    }
  }
  /** What the next load must push before the app runs: only what the host configured (an unconfigured player makes no extra VM call). */
  const loadKeys = () => {
    const keys = new Set();
    if (config.permissions || config.location !== undefined || dialogMode() !== 'none' || Object.keys(permConfig.states).length || Object.keys(permConfig.denials).length) { keys.add('permissions'); keys.add('permissionDialog'); if (config.location !== undefined) keys.add('location'); }
    for (const key of ['methodOverrides', 'ignoredActivities', 'endpointMocks']) if (config[key]?.length) keys.add(key);
    return keys;
  };
  const copyStatuses = () => ({ methodOverrides: statuses.methodOverrides.map(item => ({ ...item })), ignoredActivities: statuses.ignoredActivities.map(item => ({ ...item })), endpointMocks: statuses.endpointMocks.map(item => ({ ...item })) });
  const effective = settings => ({ ...settingsToConfig(settings), tolerateMissing: tolerate(), ...labConfigOf(config, settings) });

  const operations = {
    beginOperation() { state.busy = true; return ++state.operation; },
    finishOperation(token) { if (token !== state.operation) return; state.busy = false; if (state.pendingInputs.size || state.pendingFocus.length || state.pendingComposeActions.length || state.pendingScrolls.size || state.pendingPointers.length || state.pendingScrollBys.size) view?.flushPendingInputs(); },
    reportAPKError(error, title) {
      state.lastAPKError = { error, title }; clearPending(); hooks.interrupted?.(error);
      if (error?.navigation) state.canGoBack = !!error.navigation.canGoBack;
      if (!vm.worker) { state.runtime = null; state.apkRunning = false; }
      fail(error, title || 'runtime');
    },
    async clickView(id) {
      if (!state.runtime) return;
      // A tap that arrives while the VM is still handling the previous event is queued (Android delivers it to the main thread when it is free), not dropped: the
      // wait is bounded so a wedged VM cannot hold the tap forever, and a runtime that went away meanwhile ends it. While it waits it counts as a pending input
      // (`state.pendingClicks`, read by inputsDrained): a driver or a test that waits for the inputs to drain must not move on and type into the next field before
      // the tap reached the VM, or the tap lands after that typing (seen in the browser parity flows: a Save tap delivered after the fields it was meant to validate).
      state.pendingClicks = (state.pendingClicks ?? 0) + 1;
      try {
        for (let waited = 0; state.busy && waited < 15000; waited += 10) { await new Promise(resolve => setTimeout(resolve, 10)); if (!state.runtime || destroyed) return; }
        if (state.busy) return;
        await view.flushPendingInputs();
        if (state.busy) { for (let waited = 0; state.busy && waited < 15000; waited += 10) await new Promise(resolve => setTimeout(resolve, 10)); if (state.busy || !state.runtime) return; }   // another tap took the VM while inputs were flushed: queue behind it
        const token = operations.beginOperation();
        try { const snapshot = await state.runtime.click(id); if (token === state.operation) view.renderSnapshot(snapshot); }
        catch (error) { if (token === state.operation) operations.reportAPKError(error, 'click'); }
        finally { operations.finishOperation(token); }
      } finally { state.pendingClicks--; }
    },
    snapshotRendered(snapshot) {
      if (snapshot?.droppedEvent || snapshot?.droppedComposeAction) dropped.push(snapshot.droppedEvent ?? snapshot.droppedComposeAction);   // an event the VM could not deliver (stale View id, vanished Compose node)
      if (snapshot && ('missingVoid' in snapshot || 'missingReturns' in snapshot || 'missingClasses' in snapshot)) lastStubs = stubListsFromSnapshot(snapshot);
      if (snapshot) { lastSnapshot = snapshot; frameCount++; pluginHost?.snapshot(snapshot); hooks.rendered?.(snapshot, deviceState.settings); }
      const health = snapshot?.vmHealth;
      if (health && health.oomCount > oomSeen) {   // java.lang.OutOfMemoryError raised by the VM: reported to the embedding page even if the app swallowed it
        oomSeen = health.oomCount; fail(Object.assign(new Error(`java.lang.OutOfMemoryError: ${health.lastOom?.reason ?? 'heap exhausted'} (${health.liveObjects} live objects, limit ${health.limit})`), { details: { kind: 'java-heap-exhausted', ...health, heap: health.heapCensus } }), 'runtime');
      }
      if (snapshot && subscribed.screen) sendScreen(false);
      if (!snapshot?.activityName) return;
      if (snapshot.activityName !== lastActivity) { const first = lastActivity === null; lastActivity = snapshot.activityName; if (!first) send('activity-changed', { activity: snapshot.activityName, canGoBack: !!snapshot.canGoBack }); }
    },
    navigationChanged() {},
    closed() { send('closed'); },
  };
  /** The 'screen' event: the activity, the back stack, the windows and dialogs, as a plugin's 'screen' event gives them; sent when one of them changes. */
  function sendScreen(force) {
    const screen = screenFromSnapshot(lastSnapshot, { packageName: packageName || null, frame: frameCount }), key = screenKey(screen);
    if (!force && key === lastScreenKey) return; lastScreenKey = key; send('screen', { screen });
  }
  let dataKey = null;   // last app-data usage sent to the host: `data-status` is only emitted when it changes
  const reportData = status => {
    if (!status) return; const key = `${status.enabled}|${status.bytes}|${status.files}|${status.overLimit}|${status.error ?? ''}`; if (key === dataKey) return; dataKey = key;
    send('data-status', { status: { enabled: !!status.enabled, bytes: status.bytes | 0, files: status.files | 0, limitBytes: status.limitBytes | 0, restoredFiles: status.restoredFiles | 0, overLimit: !!status.overLimit, error: status.error ?? null } });
  };
  vm.onAppData = reportData;
  async function load(buffer, activity, dataOptions = {}) {
    state.viewSession++; clearPending(); state.runtime = null; state.apkRunning = false; lastActivity = null; oomSeen = 0; lastStubs = { void: [], returns: [], classes: [] }; packageName = ''; tolerateRunning = tolerate(); lastError = null; lastSnapshot = null; lastScreenKey = null; inventory = null;
    pendingPermissions.clear(); statuses = { methodOverrides: [], ignoredActivities: [], endpointMocks: [] }; pluginHost?.vmChanged();
    const token = operations.beginOperation();
    try {
      const keep = buffer.slice(0); source.bytes = keep;
      const settings = deviceState.settings; loaded = { memoryMiB: settings.memoryMiB ?? 0, strictCrash: config.strictCrash === true };
      const result = await vm.load(buffer, { device: deviceForVM(settings), tolerateMissing: tolerateRunning, strictCrash: loaded.strictCrash, webview: config.webview === 'on', keepData: source.keepData, clearData: !!dataOptions.clearData, motionRaster: deviceState.motionRaster !== false, memoryMiB: loaded.memoryMiB, eventSeconds: settings.eventSeconds ?? 0, logcatStreaming: wantsLogcat() }); if (token !== state.operation) return;
      logcatSent = wantsLogcat(); dataKey = null; reportData(result.appData);
      state.runtime = vm; state.inventory = result.inventory; inventory = result.inventory; packageName = String(result.inventory?.packageName || '');
      const rejected = []; await pushLab(loadKeys(), rejected); if (token !== state.operation) return;   // before any app code runs, as the panels' attach() does on the test page
      pluginHost?.vmChanged();
      const snapshot = await vm.launch(activity || undefined); if (token !== state.operation) return;
      view.renderSnapshot(snapshot);
      const inv = result.inventory; send('ready', { activity: snapshot.activityName || '', inventory: { packageName: String(inv.packageName || ''), activities: Array.isArray(inv.activities) ? inv.activities.map(value => String(value.name ?? value)).slice(0, 64) : [] }, statuses: copyStatuses(), rejected });
    } finally { operations.finishOperation(token); }
  }
  async function bytesOf(message) {
    if (message.apk) return message.apk;
    if (!fetchImpl) throw new Error('fetch is not available in this frame');
    const response = await fetchImpl(message.url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw Object.assign(new Error(`Could not load the APK (HTTP ${response.status}).`), { details: { kind: 'apk-fetch-failed', status: response.status } });
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > MAX_APK_BYTES) throw Object.assign(new Error('The APK exceeds 1 GiB.'), { details: { kind: 'apk-too-large' } });
    return buffer;
  }

  // ---- the `call` methods (revision 2): each validates its arguments, answers with a value or { code, message } -------------------------------------------------------------
  const requireRunning = () => { if (state.runtime !== vm || !vm.worker) throw callError('no-apk', 'No APK is running in the player.'); };
  function hostRedirectLines() {
    const table = new Map((lastSnapshot?.hostMap ?? []).map(record => [record.key, record]));
    return (deviceState.settings.network.hostMap ?? []).filter(rule => rule.enabled !== false).map(rule => [rule, parseRule(rule)]).filter(([, parsed]) => !parsed.error && !parsed.empty).map(([rule, parsed]) => `${describeRule(parsed)} (${hitText(table.get(ruleKey(rule)))})`);
  }
  const calls = {
    /** "Abrir": a deep link or explicit Intent, checked as the test page checks it (buildDeepLinkRequest) and normalized by the Worker's own resolver rules. */
    openIntent(args) {
      const data = shortText(args.data ?? args.link, 4096, 'data'), action = shortText(args.action, 512, 'action'), component = shortText(args.component, 512, 'component'), type = shortText(args.type, 256, 'type');
      const category = args.category ?? args.categories; if (category !== undefined && !(typeof category === 'string' ? category.length <= 512 : Array.isArray(category) && category.length <= 16 && category.every(item => typeof item === 'string' && item.length <= 512))) throw callError('bad-args', 'category must be a string or at most 16 strings');
      if (args.extras !== undefined && !(isPlain(args.extras) && Object.keys(args.extras).length <= 64 && Object.entries(args.extras).every(([key, value]) => key.length <= 256 && (typeof value !== 'string' || value.length <= 4096)))) throw callError('bad-args', 'extras must be an object of at most 64 string, number or boolean values');
      let request;
      try { request = normalizeIntentRequest({ ...buildDeepLinkRequest({ link: data ?? '', action: action ?? DEFAULT_ACTION, component: component ?? '' }), type, category, extras: args.extras }); }
      catch (error) { throw callError('bad-args', String(error?.message ?? error)); }
      return serial(async () => {
        requireRunning(); await waitIdle(); await view?.flushPendingInputs(); const token = operations.beginOperation();
        try {
          const { deepLink, snapshot } = await vm.startIntent(request);
          if (token === state.operation && snapshot) view.renderSnapshot(snapshot);
          return { deepLink: JSON.parse(JSON.stringify(deepLink ?? null)), ...describeDeepLink(deepLink) };
        } catch (error) { if (token === state.operation) operations.reportAPKError(error, 'intent'); throw callError('vm', String(error?.message ?? error).slice(0, 2000)); }
        finally { operations.finishOperation(token); }
      });
    },
    /** One inspection of the Compose layout tree (the "Compose" panel's Capturar), answered between two VM events. */
    async inspectCompose(args) {
      const maxNodes = args.maxNodes ?? 2000; if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 4000) throw callError('bad-args', 'maxNodes must be an integer from 1 to 4000');
      requireRunning(); return vm.inspectCompose({ maxNodes });
    },
    /** "Mostrar limites de layout" as data (lab.layoutBounds): the boxes of the screen shown, named from the Compose tree unless names is false. */
    async layoutBounds(args) {
      if (args.names !== undefined && typeof args.names !== 'boolean') throw callError('bad-args', 'names must be a boolean');
      if (!lastSnapshot) return [];
      let inspection = null; if (args.names !== false && vm.worker && typeof vm.inspectCompose === 'function') { try { inspection = await vm.inspectCompose({ maxNodes: 2000 }); } catch { inspection = null; } }
      return buildLayoutBoundsElements(inspection, lastSnapshot).map(layoutBoundsElementOut);
    },
    /** lab.screenshot: the whole screen or one box (key from layoutBounds) cut from the frame shown; at most one every SCREENSHOT_GAP_MS. Resolves { blob, width, height, notes }. */
    async screenshot(args) {
      const key = shortText(args.key, 200, 'key'), type = shortText(args.type, 32, 'type');
      if (args.maxWidth !== undefined && !(Number.isFinite(args.maxWidth) && args.maxWidth >= 16 && args.maxWidth <= 4096)) throw callError('bad-args', 'maxWidth must be a number from 16 to 4096');
      if (typeof captureImage !== 'function') throw callError('unsupported', 'Screen capture is not available in this frame.');
      if (!lastSnapshot) throw callError('no-apk', 'No screen is shown.');
      const wait = lastShotAt + SCREENSHOT_GAP_MS - now(); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait)); lastShotAt = now();
      let element = null;
      if (key) { element = buildLayoutBoundsElements(null, lastSnapshot).find(item => item.key === key) ?? null; if (!element) throw callError('not-found', `Element ${key.slice(0, 60)} is not on the screen (layoutBounds() lists the current keys).`); }
      const image = await captureImage({ snapshot: lastSnapshot, element, maxWidth: args.maxWidth, type });
      return { blob: image.blob, width: image.width, height: image.height, notes: Array.isArray(image.notes) ? image.notes.slice(0, 20).map(String) : [] };
    },
    /** "Estado da tela": the VM's description of the screen (activity stack, views, Compose, frames, queue, threads, memory). */
    async screenState() { if (!vm.worker) return null; return vm.screenState(); },
    /** "Copiar diagnóstico": the shared report (cause, stack, stubs, active debugging features, log tail), the screen state and the static API estimate. */
    async diagnostic() {
      const { text } = buildDiagnosticReport({ error: lastError ?? { message: 'diagnóstico pedido (sem erro)' }, product: 'APK Player', packageName: packageName || 'APK', tolerateMissing: tolerateRunning, stubs: lastError ? null : [...lastStubs.void, ...lastStubs.returns, ...lastStubs.classes],
        methodOverrides: statuses.methodOverrides.filter(item => item.state === 'active').length, ignoredActivities: statuses.ignoredActivities.filter(item => item.state === 'active').length, endpointMocks: statuses.endpointMocks.filter(item => item.state === 'active').length, hostRedirects: hostRedirectLines() });
      let screen = null; if (vm.worker) { try { screen = await vm.screenState(); } catch { screen = null; } }
      return { text: [text, screen?.text ?? '', vm.apiGaps ? formatApiGapReport(vm.apiGaps) : ''].filter(Boolean).join('\n\n').slice(0, 400000) };
    },
    /** The live state of the debugging features: the statuses the VM gave and the hit counters of the last frame. */
    status() {
      return { running: running(), activity: lastSnapshot?.activityName ?? null, packageName: packageName || null, statuses: copyStatuses(), hits: { methodOverrides: lastSnapshot?.methodOverrides ?? [], ignoredActivities: lastSnapshot?.ignoredActivities ?? [], endpointMocks: lastSnapshot?.endpointMocks ?? [], hostMap: lastSnapshot?.hostMap ?? [] },
        permissions: { states: { ...permConfig.states }, denials: { ...permConfig.denials }, once: [...permConfig.once] }, pendingPermissionRequests: [...pendingPermissions.keys()], streams: { ...subscribed }, plugins: pluginHost ? pluginHost.list().length : 0 };
    },
    answerPermission(args) {
      if (!Number.isSafeInteger(args.id)) throw callError('bad-args', 'id must be an integer');
      const ok = value => ['allow', 'once', 'deny'].includes(value), answers = args.answers;
      if (!(answers === null || ok(answers) || (Array.isArray(answers) && answers.length <= 32 && answers.every(ok)))) throw callError('bad-args', "answers must be null, 'allow' | 'once' | 'deny', or one of them per dialog");
      if (Array.isArray(answers) && pendingPermissions.has(args.id) && answers.length !== pendingPermissions.get(args.id).dialogs.length) throw callError('bad-args', `the request has ${pendingPermissions.get(args.id).dialogs.length} dialog(s)`);
      if (!answerPermission(args.id, answers)) throw callError('not-found', `No permission request ${args.id} is waiting.`);
      return { config: { states: { ...permConfig.states }, denials: { ...permConfig.denials }, once: [...permConfig.once] } };
    },
    subscribe(args) {
      if (![...STREAMS, 'screen'].includes(args.stream) || typeof args.on !== 'boolean') throw callError('bad-args', `stream must be one of ${[...STREAMS, 'screen'].join(', ')} and on a boolean`);
      subscribed[args.stream] = args.on;
      if (args.stream === 'logcat') syncLogcat(args.on);   // subscribing asks again: the Worker posts the ring's recent lines first, as when the Logcat panel opens
      if (args.stream === 'screen' && args.on && lastSnapshot) sendScreen(true);
      return { stream: args.stream, on: args.on };
    },
    /** The plugin list (src/plugin-store.js shape). Plugins run in their own Workers; output arrives as `plugin-output` events. */
    pluginsSet(args) {
      if (!Array.isArray(args.plugins) || args.plugins.length > MAX_PLUGINS || !args.plugins.every(isPlain)) throw callError('bad-args', `plugins must be a list of at most ${MAX_PLUGINS} objects`);
      const rejected = [], valid = [], ids = new Set();
      args.plugins.forEach((item, index) => {
        const plugin = normalizePlugin({ ...item, enabled: item.enabled !== false }), { errors } = validatePlugin(plugin);
        if (typeof item.code === 'string' && item.code.length > plugin.code.length) errors.push({ field: 'code', message: 'code too long' });
        if (ids.has(plugin.id)) errors.push({ field: 'id', message: 'duplicate id' });
        if (errors.length) { rejected.push(`plugins[${index}] (${errors.map(error => error.message).join(' ')})`); return; }
        ids.add(plugin.id); valid.push(plugin);
      });
      const host = ensurePluginHost(); host.setPlugins(valid);
      return { plugins: host.list().map(pluginSummary), rejected };
    },
    pluginsStop(args) { const id = shortText(args.id, 64, 'id'); const host = ensurePluginHost(); if (!host.get(id)) throw callError('not-found', `No plugin ${id}.`); host.stop(id); return pluginSummary(host.get(id)); },
    pluginsRestart(args) { const id = shortText(args.id, 64, 'id'); const host = ensurePluginHost(); if (!host.get(id)) throw callError('not-found', `No plugin ${id}.`); host.restart(id); return pluginSummary(host.get(id)); },
    pluginsList() { return pluginHost ? pluginHost.list().map(pluginSummary) : []; },
    /** "Parar VM": terminate the Worker now (a wedged app); restart() starts it again from the retained bytes. */
    stop() {
      state.operation++; state.busy = false; try { vm.cancel(); } catch { /* already gone */ }
      state.runtime = null; state.apkRunning = false; clearPending(); pendingPermissions.clear(); pluginHost?.vmChanged(); send('stopped');
      return { stopped: true };
    },
  };

  const handlers = {
    init: message => enqueue(async () => {
      source = { name: message.name || '', url: message.url, activity: message.activity, bytes: null, keepData: message.keepData === true };
      config = {}; const { rejected } = applyConfig(message.config); hooks.settingsChanged?.(deviceState.settings);
      permConfig = config.permissions ? sanitizePermissionConfig(config.permissions) : emptyConfig();
      if (rejected.length) send('config-applied', { config: effective(deviceState.settings), rejected, live: false, outcome: null });
      try { await load(await bytesOf(message), message.activity, { clearData: message.clearData === true }); } catch (error) { fail(error, 'load'); }
    }),
    config: message => enqueue(async () => {
      const { settings, rejected, parsed } = applyConfig(message.config); hooks.settingsChanged?.(settings);
      const keys = new Set(Object.keys(parsed));
      if (keys.has('permissions')) permConfig = sanitizePermissionConfig(config.permissions);
      if (keys.has('layoutBounds')) hooks.rendered?.(lastSnapshot, settings);
      const reply = extra => send('config-applied', { config: effective(settings), rejected, ...extra, statuses: copyStatuses(), ...(message.id !== undefined ? { id: message.id } : {}) });
      const live = running();
      if (message.config.tolerateMissing !== undefined && live && tolerate() !== tolerateRunning) rejected.push(`tolerateMissing (applies at the next launch: restart() the player; running with ${tolerateRunning})`);
      if (keys.has('memoryMiB') && live && (settings.memoryMiB ?? 0) !== loaded.memoryMiB) rejected.push(`memoryMiB (applies at the next launch: restart() the player; running with ${loaded.memoryMiB || 'automatic'})`);
      if (keys.has('strictCrash') && live && (config.strictCrash === true) !== loaded.strictCrash) rejected.push(`strictCrash (applies at the next launch: restart() the player; running with ${loaded.strictCrash})`);
      if (!live) { reply({ live: false, outcome: null }); return; }
      try {
        let outcome = null;
        if ([...keys].some(key => DEVICE_KEYS.includes(key))) {
          await waitIdle();   // the VM serves one request at a time: let an in-flight scheduled event or input finish first
          const result = await vm.setDevice(deviceForVM(settings)); if (result.snapshot) view.renderSnapshot(result.snapshot);
          outcome = result.outcome ? { changed: result.outcome.changed | 0, relaunched: result.outcome.relaunched | 0, delivered: result.outcome.delivered | 0 } : null;
        }
        if (keys.has('eventSeconds') && typeof vm.setTimeLimits === 'function') { try { await vm.setTimeLimits(settings.eventSeconds ?? 0); } catch (error) { rejected.push(`eventSeconds (the VM did not apply it: ${String(error?.message ?? error).slice(0, 200)})`); } }
        await pushLab(new Set([...keys].filter(key => LAB_LIVE.includes(key))), rejected);
        reply({ live: true, outcome });
      } catch (error) { fail(error, 'config'); }
    }),
    call: message => {
      const method = calls[message.method], args = message.args ?? {};
      Promise.resolve().then(() => method(args)).then(value => send('reply', { id: message.id, ok: true, value }), error => send('reply', { id: message.id, ok: false, error: { code: String(error?.code ?? 'failed').slice(0, 64), message: String(error?.message ?? error).slice(0, 4000) } }));
    },
    diagnostics: message => send('diagnostics', diagnostics(message.id)),
    back: () => enqueue(async () => {
      if (!state.runtime || !state.canGoBack) return;
      await view.flushPendingInputs(); const token = operations.beginOperation();
      try { const snapshot = await vm.back(); if (token === state.operation) view.renderSnapshot(snapshot); } catch (error) { operations.reportAPKError(error, 'back'); } finally { operations.finishOperation(token); }
    }),
    restart: () => enqueue(async () => {
      if (!source) return;
      try { await load(source.bytes ? source.bytes.slice(0) : await bytesOf({ url: source.url }), source.activity); } catch (error) { fail(error, 'restart'); }
    }),
    // Settings > Apps > Clear storage: wipe the stored data of the loaded app and restart it from the retained bytes (a killed process starts from empty storage).
    'clear-data': () => enqueue(async () => {
      if (!source) return;
      try {
        let status = null; if (vm.worker && state.runtime === vm) status = await vm.clearAppData();
        permConfig = config.permissions ? sanitizePermissionConfig(config.permissions) : emptyConfig();   // the permission state is app data too
        await load(source.bytes ? source.bytes.slice(0) : await bytesOf({ url: source.url }), source.activity, { clearData: true });
        send('data-cleared', { status: { enabled: !!(status?.enabled ?? source.keepData), bytes: 0, files: 0, limitBytes: status?.limitBytes | 0 } });
      } catch (error) { fail(error, 'clear-data'); }
    }),
    destroy: () => { destroyed = true; try { vm.cancel(); } catch { /* already gone */ } state.runtime = null; state.apkRunning = false; clearPending(); pendingPermissions.clear(); if (pluginTimer !== null) clearTimeout(pluginTimer); pluginTimer = null; pluginHost?.dispose(); hooks.destroyed?.(); },
  };
  return { operations, attach(value) { view = value; }, handle(message) { handlers[message.type](message); }, get config() { return { ...config }; }, get inflight() { return inflight; }, get dropped() { return dropped; }, get pluginHost() { return pluginHost; }, get subscribed() { return { ...subscribed }; }, sanitizeSettings, PERMISSION_DIALOG };
}
