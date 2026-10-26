import { APKError } from './apk-error.js?v=94afba6d22ec';
import { createHostRegistry } from './host-contract.js?v=94afba6d22ec';
import { resolveDevice } from './device-profile.js?v=94afba6d22ec';
import { configurationFor, resourceProfileFor } from './device-configuration.js?v=94afba6d22ec';
import { gcRoot } from './heap-gc.js?v=94afba6d22ec';
// Live changes of the virtual device (Settings panel) with ActivityThread semantics:
//   new Configuration -> resource selector re-run (original ResTable_config matching) -> live Themes rebased -> per Activity: onConfigurationChanged when the
//   manifest's android:configChanges covers every changed bit, otherwise relaunch with saved state -> Application/ComponentCallbacks -> window re-layout/insets.
// System broadcasts (time zone, locale, configuration, battery, connectivity) are sent by the broadcast host from here.
const CONFIGURATION = 'Landroid/content/res/Configuration;', ACTIVITY = 'Landroid/app/Activity;', VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;';
const CONFIG_FLAGS = { mcc: 1, mnc: 2, locale: 4, touchscreen: 8, keyboard: 0x10, keyboardHidden: 0x20, navigation: 0x40, orientation: 0x80, screenLayout: 0x100, uiMode: 0x200, screenSize: 0x400, smallestScreenSize: 0x800, density: 0x1000, layoutDirection: 0x2000, colorMode: 0x4000, fontScale: 0x40000000 };
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'device-state-unsupported', ...details }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function createDeviceStateHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  // android.text.format.DateFormat.is24HourFormat reads Settings.System.TIME_12_24, which the page's "24 horas" setting owns.
  const DATE_FORMAT = 'Landroid/text/format/DateFormat;'; type(DATE_FORMAT, 'Ljava/lang/Object;');
  def(DATE_FORMAT, 'is24HourFormat', '(Landroid/content/Context;)Z', () => platform.device.hour24 ? 1 : 0, { static: true });
  def(DATE_FORMAT, 'is24HourFormat', '(Landroid/content/Context;I)Z', () => platform.device.hour24 ? 1 : 0, { static: true });
  // ---- Broadcasts (Context.registerReceiver / sendBroadcast), sticky battery state, BatteryManager, ConnectivityManager/NetworkCallback ----------------
  const INTENT = 'Landroid/content/Intent;', RECEIVER = 'Landroid/content/BroadcastReceiver;', FILTER = 'Landroid/content/IntentFilter;', CONTEXT = 'Landroid/content/Context;', CONTEXT_WRAPPER = 'Landroid/content/ContextWrapper;', STRING = 'Ljava/lang/String;', HANDLER = 'Landroid/os/Handler;';
  const BATTERY = 'Landroid/os/BatteryManager;', CONNECTIVITY = 'Landroid/net/ConnectivityManager;', NETWORK = 'Landroid/net/Network;', CAPABILITIES = 'Landroid/net/NetworkCapabilities;', NET_INFO = 'Landroid/net/NetworkInfo;', CALLBACK = 'Landroid/net/ConnectivityManager$NetworkCallback;', REQUEST = 'Landroid/net/NetworkRequest;', REQUEST_BUILDER = 'Landroid/net/NetworkRequest$Builder;';
  type(RECEIVER, 'Ljava/lang/Object;', [], { allocatable: true }); type(FILTER, 'Ljava/lang/Object;', [], { allocatable: true }); type(CALLBACK, 'Ljava/lang/Object;', [], { allocatable: true });
  type(BATTERY, 'Ljava/lang/Object;'); type(CONNECTIVITY, 'Ljava/lang/Object;'); type(NETWORK, 'Ljava/lang/Object;', [], { allocatable: true }); type(CAPABILITIES, 'Ljava/lang/Object;', [], { allocatable: true }); type(NET_INFO, 'Ljava/lang/Object;', [], { allocatable: true }); type(REQUEST, 'Ljava/lang/Object;', [], { allocatable: true }); type(REQUEST_BUILDER, 'Ljava/lang/Object;', [], { allocatable: true });
  const registrations = gcRoot([]), callbacks = gcRoot([]), sent = { broadcasts: 0 };
  const filterOf = (r, ref) => { const o = r.object(ref); return o.intentFilter ??= { actions: [] }; };
  def(RECEIVER, '<init>', '()V', () => {}); def(RECEIVER, 'isOrderedBroadcast', '()Z', () => 0); def(RECEIVER, 'isInitialStickyBroadcast', '()Z', (r, _m, [self]) => r.object(self).initialSticky ? 1 : 0);
  def(RECEIVER, 'getResultCode', '()I', () => -1 | 0); def(RECEIVER, 'setResultCode', '(I)V', () => {}); def(RECEIVER, 'abortBroadcast', '()V', () => {});
  def(FILTER, '<init>', '()V', () => {}); def(FILTER, '<init>', `(${STRING})V`, (r, _m, [self, action]) => { filterOf(r, self).actions.push(action); });
  def(FILTER, '<init>', `(${STRING}${STRING})V`, (r, _m, [self, action]) => { filterOf(r, self).actions.push(action); });
  def(FILTER, '<init>', `(${FILTER})V`, (r, _m, [self, other]) => { filterOf(r, self).actions.push(...filterOf(r, other).actions); });
  def(FILTER, 'addAction', `(${STRING})V`, (r, _m, [self, action]) => { const f = filterOf(r, self); if (!f.actions.includes(action)) f.actions.push(action); });
  def(FILTER, 'countActions', '()I', (r, _m, [self]) => filterOf(r, self).actions.length); def(FILTER, 'getAction', '(I)' + STRING, (r, _m, [self, i]) => filterOf(r, self).actions[i] ?? null);
  def(FILTER, 'hasAction', `(${STRING})Z`, (r, _m, [self, action]) => filterOf(r, self).actions.includes(action) ? 1 : 0);
  for (const name of ['addCategory', 'addDataScheme', 'addDataType']) def(FILTER, name, `(${STRING})V`, () => {}); def(FILTER, 'setPriority', '(I)V', () => {});
  const makeIntent = (r, action, extras = {}) => {
    const intent = r.makeObject(INTENT); platform.intentInvoke(r, { owner: INTENT, name: '<init>', parameters: [STRING] }, [intent, action]);
    for (const [key, [typeName, value]] of Object.entries(extras)) platform.put(r, intent, key, typeName, value); return intent;
  };
  const batteryIntent = r => { const { level, charging } = platform.device.battery; return makeIntent(r, 'android.intent.action.BATTERY_CHANGED', { level: ['I', level], scale: ['I', 100], status: ['I', level >= 100 && charging ? 5 : charging ? 2 : 3], plugged: ['I', charging ? 2 : 0], present: ['Z', 1], health: ['I', 2], temperature: ['I', 280], voltage: ['I', 3900 + level], technology: [STRING, 'Li-ion'], battery_low: ['Z', level <= 15 && !charging ? 1 : 0], icon_small: ['I', 0] }); };
  const sticky = (r, action) => action === 'android.intent.action.BATTERY_CHANGED' ? batteryIntent(r) : null;
  const deliver = (r, action, makeExtras) => {
    for (const entry of [...registrations]) if (entry.actions.includes(action)) platform.queueTask(() => { if (!registrations.includes(entry)) return; try { call(r, entry.receiver, RECEIVER, 'onReceive', [CONTEXT, INTENT], 'V', [entry.context, makeIntent(r, action, makeExtras?.() ?? {})]); } catch (error) { if (!(error instanceof APKError)) throw error; throw error; } }, 0, [entry.receiver, entry.context]);
    sent.broadcasts++;
  };
  const register = (r, _m, args) => {
    const [, receiver, filter] = args, actions = filterOf(r, filter).actions.slice(), context = args[0];
    let result = null; for (const action of actions) { const s = sticky(r, action); if (s) result ??= s; }
    if (receiver) registrations.push({ receiver, actions, context: r.object(context).baseContext && r.isSubtype(r.object(context).type, 'Landroid/app/Activity;') ? context : context });
    if (receiver && result) { const initial = result; platform.queueTask(() => { r.object(receiver).initialSticky = true; try { call(r, receiver, RECEIVER, 'onReceive', [CONTEXT, INTENT], 'V', [context, initial]); } finally { r.object(receiver).initialSticky = false; } }, 0, [receiver, context, initial]); }
    return receiver ? result : result;
  };
  for (const owner of [CONTEXT, CONTEXT_WRAPPER]) {
    def(owner, 'registerReceiver', `(${RECEIVER}${FILTER})${INTENT}`, register); def(owner, 'registerReceiver', `(${RECEIVER}${FILTER}I)${INTENT}`, register);
    def(owner, 'registerReceiver', `(${RECEIVER}${FILTER}${STRING}${HANDLER})${INTENT}`, register); def(owner, 'registerReceiver', `(${RECEIVER}${FILTER}${STRING}${HANDLER}I)${INTENT}`, register);
    def(owner, 'unregisterReceiver', `(${RECEIVER})V`, (r, _m, [, receiver]) => { const at = registrations.findIndex(entry => entry.receiver.ref === receiver?.ref); if (at < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Receiver not registered: ' + r.typeOf(receiver)); registrations.splice(at, 1); });
    def(owner, 'sendBroadcast', `(${INTENT})V`, (r, _m, [, intent]) => { const action = r.object(intent).action; if (action) for (const entry of [...registrations]) if (entry.actions.includes(action)) platform.queueTask(() => { if (registrations.includes(entry)) call(r, entry.receiver, RECEIVER, 'onReceive', [CONTEXT, INTENT], 'V', [entry.context, intent]); }, 0, [entry.receiver, entry.context, intent]); });
    def(owner, 'sendBroadcast', `(${INTENT}${STRING})V`, (r, m, args) => r.dispatch({ owner: CONTEXT, name: 'sendBroadcast', signature: `(${INTENT})V`, parameters: [INTENT], result: 'V' }, [args[0], args[1]], 'virtual'));
  }
  // BatteryManager: capacity/charging from the device profile.
  def(BATTERY, 'isCharging', '()Z', () => platform.device.battery.charging ? 1 : 0);
  def(BATTERY, 'getIntProperty', '(I)I', (r, _m, [, id]) => { const { level, charging } = platform.device.battery; if (id === 4) return level; if (id === 6) return level >= 100 && charging ? 5 : charging ? 2 : 3; if (id === 1) return Math.round(4000000 * level / 100); if (id === 2 || id === 3) return charging ? 1200000 : -350000; if (id === 5) return Math.round(15 * 3.9 * level); return -2147483648; });
  def(BATTERY, 'getLongProperty', '(I)J', (r, _m, [, id]) => { const { level, charging } = platform.device.battery; if (id === 1) return BigInt(Math.round(4000000 * level / 100)); if (id === 2) return BigInt(charging ? 1200000 : -350000); if (id === 5) return BigInt(Math.round(15 * 3900 * level)); return -9223372036854775808n; });
  def(BATTERY, 'computeChargeTimeRemaining', '()J', () => -1n);
  // ConnectivityManager: one active network (Wi-Fi unmetered, mobile metered) or none.
  const activeNetwork = r => { const state = platform.device.connectivity; if (state === 'offline') return null; const cache = platform.networks ??= new Map(); if (!cache.has(state)) { const network = r.makeObject(NETWORK); r.object(network).netId = state === 'online' ? 100 : 101; r.object(network).transport = state === 'online' ? 1 : 0; cache.set(state, network); } return cache.get(state); };
  const capabilitiesFor = (r, network) => { const caps = r.makeObject(CAPABILITIES); r.object(caps).transport = r.object(network).transport; r.object(caps).metered = r.object(network).transport === 0; return caps; };
  def(NETWORK, 'toString', `()${STRING}`, (r, _m, [self]) => String(r.object(self).netId)); def(NETWORK, 'getNetworkHandle', '()J', (r, _m, [self]) => BigInt(r.object(self).netId));
  def(CAPABILITIES, 'hasTransport', '(I)Z', (r, _m, [self, t]) => r.object(self).transport === t ? 1 : 0);
  def(CAPABILITIES, 'hasCapability', '(I)Z', (r, _m, [self, c]) => { const o = r.object(self); if (c === 11) return o.metered ? 0 : 1; if ([12, 13, 14, 15, 16, 18, 19, 20, 21].includes(c)) return 1; return 0; });
  def(CAPABILITIES, 'getLinkDownstreamBandwidthKbps', '()I', (r, _m, [self]) => r.object(self).transport === 1 ? 100000 : 20000); def(CAPABILITIES, 'getLinkUpstreamBandwidthKbps', '()I', (r, _m, [self]) => r.object(self).transport === 1 ? 50000 : 5000);
  def(CAPABILITIES, 'toString', `()${STRING}`, (r, _m, [self]) => `[ Transports: ${r.object(self).transport === 1 ? 'WIFI' : 'CELLULAR'} Capabilities: INTERNET${r.object(self).metered ? '' : '&NOT_METERED'}&VALIDATED ]`);
  const netInfo = r => { const network = activeNetwork(r); if (!network) return null; const info = r.makeObject(NET_INFO); r.object(info).transport = r.object(network).transport; return info; };
  def(NET_INFO, 'isConnected', '()Z', () => 1); def(NET_INFO, 'isConnectedOrConnecting', '()Z', () => 1); def(NET_INFO, 'isAvailable', '()Z', () => 1); def(NET_INFO, 'getType', '()I', (r, _m, [self]) => r.object(self).transport === 1 ? 1 : 0);
  def(NET_INFO, 'getTypeName', `()${STRING}`, (r, _m, [self]) => r.object(self).transport === 1 ? 'WIFI' : 'MOBILE'); def(NET_INFO, 'isRoaming', '()Z', () => 0);
  def(CONNECTIVITY, 'getActiveNetwork', `()${NETWORK}`, r => activeNetwork(r)); def(CONNECTIVITY, 'getActiveNetworkInfo', `()${NET_INFO}`, r => netInfo(r));
  def(CONNECTIVITY, 'getNetworkCapabilities', `(${NETWORK})${CAPABILITIES}`, (r, _m, [, network]) => network ? capabilitiesFor(r, network) : null);
  def(CONNECTIVITY, 'isActiveNetworkMetered', '()Z', r => { const n = activeNetwork(r); return n && r.object(n).transport === 0 ? 1 : 0; });
  def(CONNECTIVITY, 'getAllNetworks', `()[${NETWORK}`, r => { const n = activeNetwork(r), array = r.newArray(`[${NETWORK}`, n ? 1 : 0); if (n) r.array(array).elements = [n]; return array; });
  def(REQUEST_BUILDER, '<init>', '()V', () => {}); def(REQUEST_BUILDER, 'addCapability', `(I)${REQUEST_BUILDER}`, (r, _m, [self]) => self); def(REQUEST_BUILDER, 'addTransportType', `(I)${REQUEST_BUILDER}`, (r, _m, [self]) => self);
  def(REQUEST_BUILDER, 'removeCapability', `(I)${REQUEST_BUILDER}`, (r, _m, [self]) => self); def(REQUEST_BUILDER, 'build', `()${REQUEST}`, r => r.makeObject(REQUEST));
  def(CALLBACK, '<init>', '()V', () => {}); for (const name of ['onUnavailable', 'onBlockedStatusChanged']) def(CALLBACK, name, '()V', () => {});
  def(CALLBACK, 'onAvailable', `(${NETWORK})V`, () => {}); def(CALLBACK, 'onLost', `(${NETWORK})V`, () => {}); def(CALLBACK, 'onCapabilitiesChanged', `(${NETWORK}${CAPABILITIES})V`, () => {}); def(CALLBACK, 'onLosing', `(${NETWORK}I)V`, () => {});
  const registerCallback = (r, _m, args) => { const callback = args.at(-1) && r.isSubtype(r.object(args.at(-1)).type, CALLBACK) ? args.at(-1) : args[2]; if (!callback) r.throwJava('Ljava/lang/IllegalArgumentException;', 'null NetworkCallback'); callbacks.push({ callback, network: null });
    const network = activeNetwork(r); if (network) platform.queueTask(() => { const entry = callbacks.find(value => value.callback.ref === callback.ref); if (!entry) return; entry.network = network; call(r, callback, CALLBACK, 'onAvailable', [NETWORK], 'V', [network]); call(r, callback, CALLBACK, 'onCapabilitiesChanged', [NETWORK, CAPABILITIES], 'V', [network, capabilitiesFor(r, network)]); }, 0, [callback, network]); };
  def(CONNECTIVITY, 'registerDefaultNetworkCallback', `(${CALLBACK})V`, registerCallback); def(CONNECTIVITY, 'registerDefaultNetworkCallback', `(${CALLBACK}${HANDLER})V`, registerCallback);
  def(CONNECTIVITY, 'registerNetworkCallback', `(${REQUEST}${CALLBACK})V`, registerCallback); def(CONNECTIVITY, 'registerNetworkCallback', `(${REQUEST}${CALLBACK}${HANDLER})V`, registerCallback);
  def(CONNECTIVITY, 'unregisterNetworkCallback', `(${CALLBACK})V`, (r, _m, [, callback]) => { const at = callbacks.findIndex(entry => entry.callback.ref === callback?.ref); if (at < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'NetworkCallback was not registered'); callbacks.splice(at, 1); });
  // android.net.TrafficStats: per-thread tags are kept (apps set them around network calls); the kernel byte counters and socket tagging (xt_qtaguid/eBPF) do not exist in the
  // browser, so counters report UNSUPPORTED (-1) exactly like a device whose kernel lacks them, and tagging a socket has nothing to account.
  const TRAFFIC = 'Landroid/net/TrafficStats;', SOCKET = 'Ljava/net/Socket;', FDESC = 'Ljava/io/FileDescriptor;', DATAGRAM = 'Ljava/net/DatagramSocket;';
  type(TRAFFIC, 'Ljava/lang/Object;');
  for (const [name, value] of Object.entries({ UNSUPPORTED: -1, TAG_SYSTEM_DOWNLOAD: -255, TAG_SYSTEM_MEDIA: -253, TAG_SYSTEM_BACKUP: -254, TAG_SYSTEM_RESTORE: -252, TAG_SYSTEM_APP: -251, TAG_SYSTEM_DHCP: -192, TAG_SYSTEM_NTP: -191, TAG_SYSTEM_PROBE: -190, TAG_SYSTEM_NEIGHBOR: -189, TAG_SYSTEM_GPS: -188, TAG_SYSTEM_PAC: -187, TAG_SYSTEM_DHCP_SERVER: -186 }))
    registry.staticField(TRAFFIC, name, 'I', () => value);
  const traffic = r => r.thread.traffic ??= { tag: -1, uid: -1 };
  def(TRAFFIC, 'setThreadStatsTag', '(I)V', (r, _m, [tag]) => { traffic(r).tag = tag; }, { static: true });
  def(TRAFFIC, 'getThreadStatsTag', '()I', r => traffic(r).tag, { static: true });
  def(TRAFFIC, 'clearThreadStatsTag', '()V', r => { traffic(r).tag = -1; }, { static: true });
  def(TRAFFIC, 'setThreadStatsUid', '(I)V', (r, _m, [uid]) => { traffic(r).uid = uid; }, { static: true });
  def(TRAFFIC, 'getThreadStatsUid', '()I', r => traffic(r).uid, { static: true });
  def(TRAFFIC, 'clearThreadStatsUid', '()V', r => { traffic(r).uid = -1; }, { static: true });
  def(TRAFFIC, 'incrementOperationCount', '(I)V', () => {}, { static: true }); def(TRAFFIC, 'incrementOperationCount', '(II)V', () => {}, { static: true });
  for (const [name, signature] of [['tagSocket', SOCKET], ['untagSocket', SOCKET], ['tagDatagramSocket', DATAGRAM], ['untagDatagramSocket', DATAGRAM], ['tagFileDescriptor', FDESC], ['untagFileDescriptor', FDESC]])
    def(TRAFFIC, name, `(${signature})V`, (r, _m, [target]) => { if (target === null || target === 0) r.throwJava('Ljava/lang/NullPointerException;', null); }, { static: true });
  for (const name of ['getMobileTxPackets', 'getMobileRxPackets', 'getMobileTxBytes', 'getMobileRxBytes', 'getMobileTcpRxPackets', 'getMobileTcpTxPackets', 'getTotalTxPackets', 'getTotalRxPackets', 'getTotalTxBytes', 'getTotalRxBytes', 'getTxPackets'.replace('getTxPackets', 'getMobileTcpTxPackets')])
    def(TRAFFIC, name, '()J', () => -1n, { static: true });
  for (const name of ['getUidTxBytes', 'getUidRxBytes', 'getUidTxPackets', 'getUidRxPackets']) def(TRAFFIC, name, '(I)J', () => -1n, { static: true });
  for (const name of ['getTxBytes', 'getRxBytes', 'getTxPackets', 'getRxPackets']) def(TRAFFIC, name, `(${STRING})J`, () => -1n, { static: true });
  // TelephonyManager: the virtual device carries the emulator's SIM ("Android", MCC/MNC 310260, country "us"); the data network type
  // follows the device panel (LTE on mobile data, unknown otherwise). Calls that need READ_PHONE_STATE or carrier privileges are not exposed.
  const TELEPHONY = 'Landroid/telephony/TelephonyManager;'; type(TELEPHONY, 'Ljava/lang/Object;');
  const onMobile = () => platform.device.connectivity === 'metered';
  for (const [name, value] of [['getNetworkOperatorName', 'Android'], ['getNetworkOperator', '310260'], ['getSimOperatorName', 'Android'], ['getSimOperator', '310260'], ['getNetworkCountryIso', 'us'], ['getSimCountryIso', 'us']])
    def(TELEPHONY, name, `()${STRING}`, () => value);
  def(TELEPHONY, 'getPhoneType', '()I', () => 1);                       // PHONE_TYPE_GSM
  def(TELEPHONY, 'getSimState', '()I', () => 5);                        // SIM_STATE_READY
  def(TELEPHONY, 'getNetworkType', '()I', () => onMobile() ? 13 : 0);   // NETWORK_TYPE_LTE / UNKNOWN
  def(TELEPHONY, 'isNetworkRoaming', '()Z', () => 0); def(TELEPHONY, 'hasCarrierPrivileges', '()Z', () => 0); def(TELEPHONY, 'isVoiceCapable', '()Z', () => 1);
  def(TELEPHONY, 'getPhoneCount', '()I', () => 1); def(TELEPHONY, 'getActiveModemCount', '()I', () => 1); def(TELEPHONY, 'isDataEnabled', '()Z', () => onMobile() ? 1 : 0);
  def(NET_INFO, 'getSubtype', '()I', (r, _m, [self]) => r.object(self).transport === 1 ? 0 : 13);
  def(NET_INFO, 'getSubtypeName', `()${STRING}`, (r, _m, [self]) => r.object(self).transport === 1 ? '' : 'LTE');
  const SERVICE_TYPES = { batterymanager: BATTERY, connectivity: CONNECTIVITY, phone: TELEPHONY };
  const getService = (r, name) => { const typeName = SERVICE_TYPES[name]; if (!typeName) return null; const cache = platform.deviceServiceObjects ??= new Map(); if (!cache.has(name)) cache.set(name, r.makeObject(typeName)); return cache.get(name); };
  const notify = (r, previous, next, diff) => {
    const changed = key => JSON.stringify(previous[key]) !== JSON.stringify(next[key]);
    if (diff) deliver(r, 'android.intent.action.CONFIGURATION_CHANGED');
    if (changed('locale')) deliver(r, 'android.intent.action.LOCALE_CHANGED');
    if (changed('timeZone')) deliver(r, 'android.intent.action.TIMEZONE_CHANGED', () => ({ 'time-zone': [STRING, next.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone] }));
    if (changed('hour24')) deliver(r, 'android.intent.action.TIME_SET', () => ({ 'android.intent.extra.TIME_PREF_24_HOUR_FORMAT': ['I', next.hour24 ? 1 : 2] }));
    if (changed('battery')) {
      deliver(r, 'android.intent.action.BATTERY_CHANGED', () => Object.fromEntries([...r.object(batteryIntent(r)).extras.entries()].map(([key, entry]) => [key, [entry.type, entry.value]])));
      if (previous.battery.charging !== next.battery.charging) deliver(r, next.battery.charging ? 'android.intent.action.ACTION_POWER_CONNECTED' : 'android.intent.action.ACTION_POWER_DISCONNECTED');
      if (previous.battery.level > 15 && next.battery.level <= 15 && !next.battery.charging) deliver(r, 'android.intent.action.BATTERY_LOW'); if (previous.battery.level <= 15 && next.battery.level > 15) deliver(r, 'android.intent.action.BATTERY_OKAY');
    }
    if (changed('connectivity') || changed('battery')) platform.jobScheduler?.constraintsChanged(r);
    if (changed('connectivity')) {
      r.network?.connectivityChanged();
      const network = activeNetwork(r);
      deliver(r, 'android.net.conn.CONNECTIVITY_CHANGE', () => ({ networkType: ['I', network ? (r.object(network).transport === 1 ? 1 : 0) : -1], noConnectivity: ['Z', network ? 0 : 1], isFailover: ['Z', 0], inetCondition: ['I', network ? 100 : 0] }));
      for (const entry of [...callbacks]) platform.queueTask(() => {
        if (!callbacks.includes(entry)) return;
        if (entry.network && entry.network.ref !== network?.ref) { call(r, entry.callback, CALLBACK, 'onLost', [NETWORK], 'V', [entry.network]); entry.network = null; }
        if (network && !entry.network) { entry.network = network; call(r, entry.callback, CALLBACK, 'onAvailable', [NETWORK], 'V', [network]); call(r, entry.callback, CALLBACK, 'onCapabilitiesChanged', [NETWORK, CAPABILITIES], 'V', [network, capabilitiesFor(r, network)]); }
      }, 0, [entry.callback, entry.network, network]);
    }
  };
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? values : [receiver, ...values], mode);
  const floatBits = value => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, value, true); return d.getInt32(0, true); };
  const declaredChanges = frame => { const declaration = platform.manifest?.activities?.find(value => value.descriptor === frame.type || value.name === frame.type.slice(1, -1).replaceAll('/', '.')); const value = declaration?.configChanges; return Number.isFinite(Number(value)) ? Number(value) | 0 : 0; };
  const views = (r, root, visit, seen = new Set()) => { if (!root || seen.has(root.ref) || seen.size >= 8192) return; seen.add(root.ref); visit(root); for (const child of r.object(root).children || []) views(r, child, visit, seen); };
  const applyAnimatorScale = (r, scale, initial = false) => { if (initial && scale === 1) return; if (r.classes.has('Landroid/animation/ValueAnimator;')) call(r, null, 'Landroid/animation/ValueAnimator;', 'setDurationScale', ['F'], 'V', [floatBits(scale)], 'static'); };
  const apply = (r, next) => {
    const previous = platform.device; if (same(previous, next)) return { changed: 0, relaunched: 0, delivered: 0 };
    platform.device = next;
    const seen = platform.frames.at(-1), bars = seen && (seen.root || seen.window) ? platform.systemBarsHost.describe(r, seen) : null;
    // 1. Resource selection: the original matcher now sees the new qualifiers; Themes replay their applied styles against it.
    if (platform.resourceSelector?.reconfigure) { platform.resourceSelector.reconfigure(resourceProfileFor(next, bars?.insets)); platform.styleBackend.refreshThemes(r); }
    // 2. Configuration object (identity retained, as Resources.getConfiguration()) + DisplayMetrics.
    let diff = 0, current = null;
    if (platform.configuration && r.classes.has(CONFIGURATION)) {
      current = platform.configuration; const fresh = r.allocate(CONFIGURATION); call(r, fresh, CONFIGURATION, '<init>', [], 'V', [], 'direct'); platform.initializeConfiguration(r, fresh);
      diff = call(r, current, CONFIGURATION, 'diff', [CONFIGURATION], 'I', [fresh]); call(r, current, CONFIGURATION, 'setTo', [CONFIGURATION], 'V', [fresh]);
      // The page-level system settings that are not Configuration fields (animator scale, time zone, battery, connectivity) are applied below.
    }
    platform.updateMetrics(r);
    if (previous.animatorScale !== next.animatorScale) { applyAnimatorScale(r, next.animatorScale); platform.contentHost.notifySetting(r, 'animator_duration_scale'); }
    let delivered = 0, relaunched = 0;
    if (diff) {
      r.record(`DEVICE configuration changed: diff=0x${(diff >>> 0).toString(16)} -> ${Object.entries(CONFIG_FLAGS).filter(([, flag]) => diff & flag).map(([name]) => name).join(',')}`);
      // 3. Activities: the stack is processed bottom-up; each one either handles the change (android:configChanges) or is relaunched with saved state.
      for (const frame of [...platform.frames]) {
        if (frame.finished || frame.destroyed || !platform.frames.includes(frame)) continue;
        if ((diff & ~declaredChanges(frame)) === 0) {
          call(r, frame.activity, frame.type, 'onConfigurationChanged', [CONFIGURATION], 'V', [current]); delivered++;
          views(r, frame.root, view => { if (r.objectOverride?.(r.object(view).type, 'onConfigurationChanged(Landroid/content/res/Configuration;)V')) call(r, view, VIEW, 'onConfigurationChanged', [CONFIGURATION], 'V', [current]); });
        } else { platform.recreateActivity(r, frame); relaunched++; }
      }
      platform.componentCallbacksHost.dispatchConfiguration(r, current);
    }
    // 4. Window: the system bars/insets and the content frame follow the new size, orientation and navigation mode.
    platform.systemBarsHost.notifyChanged(r);
    notify(r, previous, next, diff);
    return { changed: 1, diff, delivered, relaunched };
  };
  return { ...registry, getService, applyAnimatorScale, apply, resolve: settings => resolveDevice(settings), CONFIG_FLAGS };
}
