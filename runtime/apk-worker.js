import { loadAPK } from './apk-loader.js?v=f2127a72f766';
import { FrameworkProvider } from './framework-provider.js?v=f2127a72f766';
import { createRasterSender } from './raster-cache.js?v=f2127a72f766';
import { isFreedId } from './heap-gc.js?v=f2127a72f766';
import { dispatchPointer } from './pointer-input-host.js?v=f2127a72f766';
import { resolveDevice } from './device-profile.js?v=f2127a72f766';
import { FrameworkResourceProvider } from './framework-resource-provider.js?v=f2127a72f766';
import { ResourceConfigProvider } from './resource-config-provider.js?v=f2127a72f766';
import { SkiaProvider } from './skia-provider.js?v=f2127a72f766';
import { createComposeSemanticsDriver, STALE_NODE_KIND } from './compose-semantics.js?v=f2127a72f766';
import { disposeTextLayout } from './text-layout-native.js?v=f2127a72f766';
import { IcuBreakProvider } from './icu-break-provider.js?v=f2127a72f766';
import { SqliteProvider } from './sqlite-native.js?v=f2127a72f766';
import { TzdataProvider } from './java-time-native.js?v=f2127a72f766';
import { ZlibProvider } from './zip-native.js?v=f2127a72f766';
import { IcuConverterProvider } from './icu-converter-native.js?v=f2127a72f766';
import { disposeColorFilters } from './color-filter-native.js?v=f2127a72f766';
import { disposeRegex } from './regex-native.js?v=f2127a72f766';
import { disposeRenderNodes } from './rendernode-native.js?v=f2127a72f766';
const CONFIGURATION_PROFILE_URL = '../framework-aosp/profiles/configuration/framework.dex?v=f2127a72f766';
const LAYOUT_PROFILE_URL = '../framework-aosp/profiles/layouts/framework.dex?v=f2127a72f766';
const SKIA_ASSET_URL = '../vendor/canvaskit/0.42.0/';
const RESOURCE_CONFIG_URL = '../framework-aosp/native-config/resource-config.wasm?v=f2127a72f766';
const FRAMEWORK_RESOURCE_URL = '../framework-resources/framework-resources.json.gz?v=f2127a72f766';
const FRAMEWORK_ASSET_URL = '../framework-aosp/framework.dex?v=f2127a72f766';

let sharedSkiaProvider = null;
let sharedICUBreakProvider = null, sharedSqliteProvider = null, sharedTzdataProvider = null, sharedZlibProvider = null, sharedIcuConverterProvider = null;
let sharedLayoutProvider = null;
let sharedConfigurationProvider = null;
let runtime = null;
let composeSemantics = null;
let inspectNativeLibraries = null;
let inventory = null;
let activeRequestId = null;
let busy = false;
let eventTimer = null, lastEventMs = 0;
function errorData(error) { return { name: error.name || 'Error', message: error.message || String(error), stack: error.stack, details: error.details, navigation: runtime?.platform?.navigationState?.(runtime), trace: Array.isArray(runtime?.trace) ? runtime.trace.slice(-512) : [], stubs: runtime ? [...(runtime.missingClasses ?? []), ...(runtime.missingReturns ?? []), ...(runtime.missingVoid ?? [])].map(([key, count]) => `${key} x${count}`) : [] }; }
const rasterSender = createRasterSender();
function currentSnapshot() {
  runtime.steps = 0; // A bounded inspection event, separate from the APK callback that just finished.
  const snapshot = runtime.snapshot();
  if (!snapshot.closed && composeSemantics) snapshot.composeSemantics = composeSemantics.snapshot();
  Object.assign(snapshot, runtime.executionSnapshot());
  // VM health the page can show: live Java objects, collections, and any OutOfMemoryError the VM raised (even if the app caught it).
  snapshot.queueDebug = (runtime.platform.eventQueue || []).slice(0, 6).map(event => Object.keys(event).filter(key => !['when', 'sequence', 'front', 'roots'].includes(key)).join('/') + '@' + Math.round(event.when - runtime.platform.clock.now()));
  snapshot.pendingEventDelay = runtime.platform.nextEventDelay?.() ?? null;   // ms until the VM's next scheduled event (frame, timer); null when nothing is scheduled
  snapshot.vmHealth = { liveObjects: runtime.heap.size, limit: runtime.maxHeapObjects, lastEventMs, collections: runtime.gcStats?.collections ?? 0, freedObjects: runtime.gcStats?.freed ?? 0, oomCount: runtime.oomCount ?? 0, lastOom: runtime.lastOom ?? null };
  return rasterSender.intern(snapshot); // repeated PNGs travel once; the page resolves rasterId to a cached Blob URL
}
function drainReadyEvents() {
  let processed = 0, result;
  for (let round = 0; round < 32; round++) {
    result = runtime.platform.drainEvents(runtime); processed += result.processed;
    if (!result.processed || result.nextDelay !== 0) break;
  }
  return {...result, processed};
}
function scheduleEvents() {
  clearTimeout(eventTimer); eventTimer = null;
  if (!runtime?.platform?.nextEventDelay) return;
  const delay = runtime.platform.nextEventDelay();
  if (delay == null) return;
  eventTimer = setTimeout(() => {
    if (busy) { scheduleEvents(); return; }
    busy = true; let succeeded = false;
    self.postMessage({ type: 'runtime-busy' });   // the page must not treat the screen as settled while a scheduled VM event is being processed
    try {
      const started = performance.now(), drained = drainReadyEvents(); lastEventMs = Math.round(performance.now() - started);
      if (drained.processed) self.postMessage({ type: 'runtime-event', snapshot: currentSnapshot() }); else self.postMessage({ type: 'runtime-idle' });
      succeeded = true;
    } catch (error) { self.postMessage({ type: 'runtime-error', error: errorData(error) }); }
    finally { busy = false; if (succeeded) scheduleEvents(); }
  }, Math.min(2147483647, Math.max(0, delay)));
}
self.onmessage = async ({ data }) => {
  if (!data || !Number.isSafeInteger(data.requestId)) return;
  const { requestId, type } = data;
  const send = (message) => self.postMessage({ requestId, ...message });
  if (busy) { send({ type: 'error', error: { name: 'ProtocolError', message: 'A VM já está processando outra operação.' } }); return; }
  busy = true; activeRequestId = requestId; let succeeded = false; clearTimeout(eventTimer);
  try {
    if (type === 'load') {
      rasterSender.reset();
      if (runtime) { disposeRegex(runtime); disposeRenderNodes(runtime); disposeTextLayout(runtime); disposeColorFilters(runtime); } runtime?.skiaHost?.dispose?.(); runtime = null; composeSemantics = null;
      if (!(data.buffer instanceof ArrayBuffer)) throw new TypeError('O Worker precisa receber um ArrayBuffer de APK.');
      const frameworkProvider = data.frameworkDex ? new FrameworkProvider({ bytes: data.frameworkDex }) : FRAMEWORK_ASSET_URL ? new FrameworkProvider({ url: new URL(FRAMEWORK_ASSET_URL, import.meta.url), provenanceURL: new URL(FRAMEWORK_ASSET_URL.replace('framework.dex', 'manifestprovenance.json'), import.meta.url) }) : null;
      const frameworkResourceProvider = data.frameworkResources ? new FrameworkResourceProvider({ data: data.frameworkResources }) : FRAMEWORK_RESOURCE_URL ? new FrameworkResourceProvider({ url: new URL(FRAMEWORK_RESOURCE_URL, import.meta.url), provenanceURL: new URL(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'provenance.json'), import.meta.url), xmlIndexURL: new URL(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'framework-xml-index.json'), import.meta.url), xmlDataURL: new URL(FRAMEWORK_RESOURCE_URL.replace('framework-resources.json.gz', 'framework-xml.bin.gz'), import.meta.url) }) : null;
      const resourceConfigProvider = data.resourceConfigBytes ? new ResourceConfigProvider({ bytes: data.resourceConfigBytes, metadata: data.resourceConfigMetadata }) : RESOURCE_CONFIG_URL ? new ResourceConfigProvider({ url: new URL(RESOURCE_CONFIG_URL, import.meta.url), provenanceURL: new URL(RESOURCE_CONFIG_URL.replace('resource-config.wasm', 'provenance.json'), import.meta.url) }) : null;
      const skiaProvider = SKIA_ASSET_URL ? (sharedSkiaProvider ??= new SkiaProvider({ baseURL: new URL(SKIA_ASSET_URL, import.meta.url) })) : null;
      const layouts = data.layoutProfileDex ? new FrameworkProvider({ bytes: data.layoutProfileDex, filename: 'framework-aosp/profiles/layouts/framework.dex', metadata: data.layoutProfileMetadata }) : LAYOUT_PROFILE_URL ? (sharedLayoutProvider ??= new FrameworkProvider({ url: new URL(LAYOUT_PROFILE_URL, import.meta.url), filename: 'framework-aosp/profiles/layouts/framework.dex', provenanceURL: new URL(LAYOUT_PROFILE_URL.replace('framework.dex', 'framework-provenance.json'), import.meta.url) })) : null;
      const configuration = CONFIGURATION_PROFILE_URL ? (sharedConfigurationProvider ??= new FrameworkProvider({ url: new URL(CONFIGURATION_PROFILE_URL, import.meta.url), filename: 'framework-aosp/profiles/configuration/framework.dex', provenanceURL: new URL(CONFIGURATION_PROFILE_URL.replace('framework.dex', 'framework-provenance.json'), import.meta.url) })) : null;
      const frameworkProfileProviders = { ...(layouts ? { layouts } : {}), ...(configuration ? { configuration } : {}) };
      const icuBreakProvider = sharedICUBreakProvider ??= new IcuBreakProvider();
      const sqliteProvider = sharedSqliteProvider ??= new SqliteProvider(), tzdataProvider = sharedTzdataProvider ??= new TzdataProvider(), zlibProvider = sharedZlibProvider ??= new ZlibProvider(), icuConverterProvider = sharedIcuConverterProvider ??= new IcuConverterProvider();
      // The browser product lays every APK's Views out in the VM (original AOSP LinearLayout/FrameLayout/ScrollView + Skia text), never with page CSS.
      const result = await loadAPK(data.buffer, { device: resolveDevice(data.device || {}), tolerateMissing: ['void', 'primitives', 'all'].includes(data.tolerateMissing) ? data.tolerateMissing : 'off', enableLayoutProfile: layouts ? true : undefined, forceSkia: skiaProvider ? true : undefined, frameworkProfileProviders, frameworkProvider, frameworkResourceProvider, resourceConfigProvider, skiaProvider, icuBreakProvider, sqliteProvider, tzdataProvider, zlibProvider, icuConverterProvider, onProgress: (progress) => self.postMessage({ type: 'progress', requestId: activeRequestId, progress }) });
      runtime = result.runtime; inventory = result.inventory; inspectNativeLibraries = result.inspectNativeLibraries;
      if (self.location?.origin) runtime.javaProperties.set('apkweb.origin', self.location.origin);   // the page origin (same as this worker's): lets sample apps address documents the lab serves itself
      runtime.platform.onExternalActivity = () => { if (!busy) scheduleEvents(); };   // network exchanges finishing wake the event pump
      composeSemantics = createComposeSemanticsDriver(runtime);
      runtime.gcEnabled = data.gc !== false;   // unreachable Java objects are reclaimed between events (src/heap-gc.js)
      send({ type: 'result', inventory: result.inventory });
    } else if (type === 'device') {
      // Virtual-device settings changed while an APK runs: Configuration/resources/lifecycle exactly like ActivityThread.handleConfigurationChanged.
      if (!runtime) { send({ type: 'result', outcome: { changed: 0, applied: false } }); }
      else { runtime.steps = 0; const outcome = runtime.platform.deviceState.apply(runtime, resolveDevice(data.device || {})); drainReadyEvents(); send({ type: 'result', outcome, snapshot: currentSnapshot() }); }
    } else if (type === 'inspect-native') {
      if (!runtime || typeof inspectNativeLibraries !== 'function') throw new Error('Reabra o APK para disponibilizar a inspeção ELF.');
      const libraries = await inspectNativeLibraries(data.paths, data.limits);
      send({ type: 'result', libraries, nativeInspection: inventory.nativeInspection });
    } else if (type === 'launch' || type === 'click' || type === 'back' || type === 'input' || type === 'check' || type === 'focus' || type === 'press' || type === 'scroll' || type === 'compose-action' || type === 'pointer') {
      if (!runtime) throw new Error('Reabra um APK antes de executar a VM.');
      send({ type: 'progress', progress: { phase: type, completed: 0, total: 1 } });
      runtime.steps = 0; let droppedComposeAction = null, droppedEvent = null;
      // An id the page took from an older snapshot can name a View that has since been collected (it was removed from the hierarchy): Android would not deliver the event either.
      const staleId = ['click', 'input', 'check', 'focus', 'press', 'scroll'].includes(type) ? data.id : type === 'compose-action' || type === 'pointer' ? data.ownerViewId : null;
      if (staleId !== null && isFreedId(runtime, staleId)) {
        droppedEvent = { kind: 'stale-view-id', type, id: staleId };
        runtime.record(`EVENT dropped (${type} on View ${staleId} that no longer exists)`);
      }
      else if (type === 'scroll') {
        if (![data.x,data.y].every(value=>Number.isInteger(value)&&value>=-2147483648&&value<=2147483647)) throw new TypeError('A rolagem requer coordenadas inteiras Android.');
        const receiver={ref:data.id};
        if(!runtime.isSubtype(runtime.object(receiver).type,'Landroid/view/View;'))throw new TypeError('O alvo de rolagem precisa ser uma View real.');
        runtime.dispatch({owner:'Landroid/view/View;',name:'scrollTo',parameters:['I','I'],result:'V',signature:'(II)V'},[receiver,data.x,data.y],'virtual');
      }
      else if (type === 'pointer') { const outcome = dispatchPointer(runtime, data); if (outcome.dropped && outcome.dropped !== 'unchanged') { droppedEvent = { kind: 'pointer-' + outcome.dropped, type, id: data.ownerViewId }; runtime.record(`EVENT dropped (pointer ${data.action}: ${outcome.dropped})`); } }
      else if (type === 'compose-action') {
        try { composeSemantics.performAction({ownerViewId:data.ownerViewId,nodeId:data.nodeId,action:data.action,args:data.args}); }
        catch (error) {
          // Only a vanished target is dropped; every other semantics failure (unsupported action, bad args, VM error) still aborts.
          if (error?.details?.kind !== STALE_NODE_KIND) throw error;
          droppedComposeAction = { kind: STALE_NODE_KIND, ownerViewId: data.ownerViewId, nodeId: data.nodeId, action: data.action, message: error.message };
          runtime.record(`COMPOSE-ACTION dropped (stale node ${data.ownerViewId}:${data.nodeId} ${data.action}): ${error.message}`);
        }
      }
      else if (type === 'focus') runtime.dispatch({ owner: 'Landroid/view/View;', name: data.focused ? 'requestFocus' : 'clearFocus', signature: data.focused ? '()Z' : '()V', parameters: [], result: data.focused ? 'Z' : 'V' }, [{ ref: data.id }], 'virtual');
      else if (type === 'press') runtime.dispatch({ owner: 'Landroid/view/View;', name: 'setPressed', signature: '(Z)V', parameters: ['Z'], result: 'V' }, [{ ref: data.id }, data.pressed ? 1 : 0], 'virtual');
      else if (type === 'input') runtime.platform.setInput(runtime, data.id, data.text);
      else if (type === 'check') runtime.platform.checkInput(runtime, data.id, data.checked);
      else await (type === 'launch' ? runtime.launch(data.activity) : type === 'back' ? runtime.back() : runtime.click(data.id));
      drainReadyEvents();
      const resultSnapshot = currentSnapshot(); if (droppedComposeAction) resultSnapshot.droppedComposeAction = droppedComposeAction; if (droppedEvent) resultSnapshot.droppedEvent = droppedEvent;
      send({ type: 'result', snapshot: resultSnapshot });
    } else throw new Error(`Operação de Worker desconhecida: ${type}`);
    succeeded = true;
  } catch (error) {
    send({ type: 'error', error: errorData(error) });
  } finally { busy = false; if (succeeded) scheduleEvents(); }
};
