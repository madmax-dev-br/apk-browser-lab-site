// Message-driven controller of one player frame. DOM-free: the VM client, the shared device view and the postMessage sink are injected, so the
// same code runs in the real frame (frame.js) and in the headless smoke test.
import { configToSettings, parseConfig, settingsToConfig, describeError, envelope, MAX_APK_BYTES } from './protocol.js?v=5db7b8182013';
import { sanitizeSettings } from '../device-settings.js?v=5db7b8182013';
export function createFrameController({ vm, state, deviceState, post, fetchImpl = globalThis.fetch?.bind(globalThis), hooks = {} }) {
  let view = null, source = null, config = {}, lastActivity = null, destroyed = false, chain = Promise.resolve(), inflight = 0, oomSeen = 0; const dropped = [];
  const send = (type, payload) => post(envelope(type, payload));
  const fail = (error, phase) => { const info = describeError(error, phase); hooks.error?.(info); send('error', info); };
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
  async function load(buffer, activity) {
    state.viewSession++; clearPending(); state.runtime = null; state.apkRunning = false; lastActivity = null; oomSeen = 0;
    const token = operations.beginOperation();
    try {
      const keep = buffer.slice(0); source.bytes = keep;
      const result = await vm.load(buffer, { device: deviceState.settings }); if (token !== state.operation) return;
      state.runtime = vm; state.inventory = result.inventory;
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
      source = { name: message.name || '', url: message.url, activity: message.activity, bytes: null };
      config = {}; applyConfig(message.config); hooks.settingsChanged?.(deviceState.settings);
      try { await load(await bytesOf(message), message.activity); } catch (error) { fail(error, 'load'); }
    }),
    config: message => enqueue(async () => {
      const { settings, rejected } = applyConfig(message.config); hooks.settingsChanged?.(settings);
      if (state.runtime !== vm || !state.apkRunning) { send('config-applied', { config: settingsToConfig(settings), rejected, live: false, outcome: null }); return; }
      try {
        const { outcome, snapshot } = await vm.setDevice(settings); if (snapshot) view.renderSnapshot(snapshot);
        send('config-applied', { config: settingsToConfig(settings), rejected, live: true, outcome: outcome ? { changed: outcome.changed | 0, relaunched: outcome.relaunched | 0, delivered: outcome.delivered | 0 } : null });
      } catch (error) { fail(error, 'config'); }
    }),
    back: () => enqueue(async () => {
      if (!state.runtime || !state.canGoBack) return;
      await view.flushPendingInputs(); const token = operations.beginOperation();
      try { const snapshot = await vm.back(); if (token === state.operation) view.renderSnapshot(snapshot); } catch (error) { operations.reportAPKError(error, 'back'); } finally { operations.finishOperation(token); }
    }),
    restart: () => enqueue(async () => {
      if (!source) return;
      try { await load(source.bytes ? source.bytes.slice(0) : await bytesOf({ url: source.url }), source.activity); } catch (error) { fail(error, 'restart'); }
    }),
    destroy: () => { destroyed = true; try { vm.cancel(); } catch { /* already gone */ } state.runtime = null; state.apkRunning = false; clearPending(); hooks.destroyed?.(); },
  };
  return { operations, attach(value) { view = value; }, handle(message) { handlers[message.type](message); }, get config() { return { ...config }; }, get inflight() { return inflight; }, get dropped() { return dropped; }, sanitizeSettings };
}
