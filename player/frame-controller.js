// Message-driven controller of one player frame. DOM-free: the VM client, the shared device view and the postMessage sink are injected, so the
// same code runs in the real frame (frame.js) and in the headless smoke test.
import { configToSettings, parseConfig, settingsToConfig, describeError, envelope, stubListsFromSnapshot, MAX_APK_BYTES } from './protocol.js?v=58b0147dafd8';
import { buildDiagnosticReport } from '../diagnostic-report.js?v=58b0147dafd8';
import { sanitizeSettings } from '../device-settings.js?v=58b0147dafd8';
export function createFrameController({ vm, state, deviceState, post, fetchImpl = globalThis.fetch?.bind(globalThis), hooks = {} }) {
  let view = null, source = null, config = {}, lastActivity = null, destroyed = false, chain = Promise.resolve(), inflight = 0, oomSeen = 0, lastStubs = { void: [], returns: [], classes: [] }, packageName = '', tolerateRunning = 'off'; const dropped = [];
  const send = (type, payload) => post(envelope(type, payload));
  const tolerate = () => config.tolerateMissing ?? 'off';
  const fail = (error, phase) => {
    const info = describeError(error, phase, { packageName, tolerateMissing: tolerateRunning });
    if (!error?.stubLists && lastStubs.void.length + lastStubs.returns.length + lastStubs.classes.length) { info.stubs = lastStubs; }   // errors raised outside the Worker (OOM, dropped events) still carry the stubs of the live run
    hooks.error?.(info); send('error', info);
  };
  const diagnostics = id => {
    const { text } = buildDiagnosticReport({ error: { message: 'diagnostics requested (no error)' }, product: 'APK Player', packageName: packageName || 'APK', tolerateMissing: tolerateRunning, stubs: [...lastStubs.void, ...lastStubs.returns, ...lastStubs.classes] });
    return { id, stubs: lastStubs, tolerateMissing: tolerateRunning, packageName, report: text.slice(0, 65000) };
  };
  const clearPending = () => { state.pendingInputs.clear(); state.pendingFocus.length = 0; state.pendingComposeActions.length = 0; state.pendingScrolls.clear(); state.pendingPointers.length = 0; state.pendingScrollBys.clear(); };
  const enqueue = work => { inflight++; chain = chain.then(() => (destroyed ? undefined : work())).catch(error => fail(error, 'operation')).finally(() => { inflight--; }); return chain; };
  const applyConfig = patch => {
    const { config: parsed, rejected } = parseConfig(patch); const next = { ...config, ...parsed }, { settings, rejected: more } = configToSettings(next);
    config = next; deviceState.settings = settings; return { settings, rejected: [...rejected, ...more] };
  };
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
      if (!state.runtime || state.busy) return;
      await view.flushPendingInputs(); const token = operations.beginOperation();
      try { const snapshot = await state.runtime.click(id); if (token === state.operation) view.renderSnapshot(snapshot); }
      catch (error) { if (token === state.operation) operations.reportAPKError(error, 'click'); }
      finally { operations.finishOperation(token); }
    },
    snapshotRendered(snapshot) {
      if (snapshot?.droppedEvent || snapshot?.droppedComposeAction) dropped.push(snapshot.droppedEvent ?? snapshot.droppedComposeAction);   // an event the VM could not deliver (stale View id, vanished Compose node)
      if (snapshot && ('missingVoid' in snapshot || 'missingReturns' in snapshot || 'missingClasses' in snapshot)) lastStubs = stubListsFromSnapshot(snapshot);
      const health = snapshot?.vmHealth;
      if (health && health.oomCount > oomSeen) {   // java.lang.OutOfMemoryError raised by the VM: reported to the embedding page even if the app swallowed it
        oomSeen = health.oomCount; fail(Object.assign(new Error(`java.lang.OutOfMemoryError: ${health.lastOom?.reason ?? 'heap exhausted'} (${health.liveObjects} live objects, limit ${health.limit})`), { details: { kind: 'java-heap-exhausted', ...health } }), 'runtime');
      }
      if (!snapshot?.activityName) return;
      if (snapshot.activityName !== lastActivity) { const first = lastActivity === null; lastActivity = snapshot.activityName; if (!first) send('activity-changed', { activity: snapshot.activityName, canGoBack: !!snapshot.canGoBack }); }
    },
    navigationChanged() {},
    closed() { send('closed'); },
  };
  let dataKey = null;   // last app-data usage sent to the host: `data-status` is only emitted when it changes
  const reportData = status => {
    if (!status) return; const key = `${status.enabled}|${status.bytes}|${status.files}|${status.overLimit}|${status.error ?? ''}`; if (key === dataKey) return; dataKey = key;
    send('data-status', { status: { enabled: !!status.enabled, bytes: status.bytes | 0, files: status.files | 0, limitBytes: status.limitBytes | 0, restoredFiles: status.restoredFiles | 0, overLimit: !!status.overLimit, error: status.error ?? null } });
  };
  vm.onAppData = reportData;
  async function load(buffer, activity, dataOptions = {}) {
    state.viewSession++; clearPending(); state.runtime = null; state.apkRunning = false; lastActivity = null; oomSeen = 0; lastStubs = { void: [], returns: [], classes: [] }; packageName = ''; tolerateRunning = tolerate();
    const token = operations.beginOperation();
    try {
      const keep = buffer.slice(0); source.bytes = keep;
      const result = await vm.load(buffer, { device: deviceState.settings, tolerateMissing: tolerateRunning, keepData: source.keepData, clearData: !!dataOptions.clearData }); if (token !== state.operation) return;
      dataKey = null; reportData(result.appData);
      state.runtime = vm; state.inventory = result.inventory; packageName = String(result.inventory?.packageName || '');
      const snapshot = await vm.launch(activity || undefined); if (token !== state.operation) return;
      view.renderSnapshot(snapshot);
      const inv = result.inventory; send('ready', { activity: snapshot.activityName || '', inventory: { packageName: String(inv.packageName || ''), activities: Array.isArray(inv.activities) ? inv.activities.map(value => String(value.name ?? value)).slice(0, 64) : [] } });
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
  const handlers = {
    init: message => enqueue(async () => {
      source = { name: message.name || '', url: message.url, activity: message.activity, bytes: null, keepData: message.keepData === true };
      config = {}; applyConfig(message.config); hooks.settingsChanged?.(deviceState.settings);
      try { await load(await bytesOf(message), message.activity, { clearData: message.clearData === true }); } catch (error) { fail(error, 'load'); }
    }),
    config: message => enqueue(async () => {
      const { settings, rejected } = applyConfig(message.config); hooks.settingsChanged?.(settings);
      const effective = () => ({ ...settingsToConfig(settings), tolerateMissing: tolerate() });
      if (message.config.tolerateMissing !== undefined && state.runtime === vm && state.apkRunning && tolerate() !== tolerateRunning) rejected.push(`tolerateMissing (applies at the next launch: restart() the player; running with ${tolerateRunning})`);
      if (state.runtime !== vm || !state.apkRunning) { send('config-applied', { config: effective(), rejected, live: false, outcome: null }); return; }
      try {
        const { outcome, snapshot } = await vm.setDevice(settings); if (snapshot) view.renderSnapshot(snapshot);
        send('config-applied', { config: effective(), rejected, live: true, outcome: outcome ? { changed: outcome.changed | 0, relaunched: outcome.relaunched | 0, delivered: outcome.delivered | 0 } : null });
      } catch (error) { fail(error, 'config'); }
    }),
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
        await load(source.bytes ? source.bytes.slice(0) : await bytesOf({ url: source.url }), source.activity, { clearData: true });
        send('data-cleared', { status: { enabled: !!(status?.enabled ?? source.keepData), bytes: 0, files: 0, limitBytes: status?.limitBytes | 0 } });
      } catch (error) { fail(error, 'clear-data'); }
    }),
    destroy: () => { destroyed = true; try { vm.cancel(); } catch { /* already gone */ } state.runtime = null; state.apkRunning = false; clearPending(); hooks.destroyed?.(); },
  };
  return { operations, attach(value) { view = value; }, handle(message) { handlers[message.type](message); }, get config() { return { ...config }; }, get inflight() { return inflight; }, get dropped() { return dropped; }, sanitizeSettings };
}
