import { createHostRegistry } from './host-contract.js?v=57d10730b49f';

// The rest of android.telephony for an offline phone with the emulator's SIM that device-state-host.js already declares (SIM ready, 310260, "Android", no radio cells):
//   PhoneStateListener / TelephonyManager.listen              (TelephonyManager.listen -> TelephonyRegistry.listenWithEventList, android-13.0.0_r1)
//   TelephonyCallback + its *Listener interfaces / registerTelephonyCallback / unregisterTelephonyCallback
//   getCallState, getDataState, getDataActivity, getCellLocation, getAllCellInfo, identifiers and the plain capability queries
//   CellLocation / GsmCellLocation (frameworks/base/telephony/java/android/telephony/{CellLocation,gsm/GsmCellLocation}.java)
// The permission rules of TelephonyRegistry.checkListenerPermission are applied as written there; the initial notification TelephonyRegistry sends when a listener is added is delivered
// from the platform task queue (through the registered Executor for TelephonyCallback) with the values below. ServiceState, SignalStrength, TelephonyDisplayInfo and the precise-state
// objects are not available in the VM, so the events that carry them (and READ_PRECISE_PHONE_STATE ones) are not delivered and say so in the VM log.
const TM = 'Landroid/telephony/TelephonyManager;', LISTENER = 'Landroid/telephony/PhoneStateListener;', CALLBACK = 'Landroid/telephony/TelephonyCallback;';
const CELL_LOCATION = 'Landroid/telephony/CellLocation;', GSM_CELL_LOCATION = 'Landroid/telephony/gsm/GsmCellLocation;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
const EXECUTOR = 'Ljava/util/concurrent/Executor;', RUNNABLE = 'Ljava/lang/Runnable;', BUNDLE = 'Landroid/os/Bundle;', LIST = 'Ljava/util/List;', DELIVERY = 'Lapkweb/bridge/TelephonyDelivery;';
const FINE = 'android.permission.ACCESS_FINE_LOCATION', COARSE = 'android.permission.ACCESS_COARSE_LOCATION', READ_PHONE_STATE = 'android.permission.READ_PHONE_STATE';
const READ_PHONE_NUMBERS = 'android.permission.READ_PHONE_NUMBERS', READ_SMS = 'android.permission.READ_SMS';
const Q = 29, S = 31;

// PhoneStateListener.LISTEN_* -> TelephonyCallback.EVENT_* (only used for the exception text) and what each carries.
const LISTEN = { SERVICE_STATE: 1, SIGNAL_STRENGTH: 2, MESSAGE_WAITING: 4, CALL_FORWARDING: 8, CELL_LOCATION: 16, CALL_STATE: 32, DATA_CONNECTION_STATE: 64, DATA_ACTIVITY: 128, SIGNAL_STRENGTHS: 256,
  CELL_INFO: 1024, PRECISE_CALL_STATE: 2048, PRECISE_DATA_CONNECTION_STATE: 4096, CALL_DISCONNECT_CAUSES: 33554432, IMS_CALL_DISCONNECT_CAUSES: 134217728, USER_MOBILE_DATA_STATE: 0x80000,
  DISPLAY_INFO_CHANGED: 0x100000, EMERGENCY_NUMBER_LIST: 0x1000000, ACTIVE_DATA_SUBSCRIPTION_ID_CHANGE: 0x400000, REGISTRATION_FAILURE: 0x40000000, BARRING_INFO: 0x80000000 | 0 };   // BARRING_INFO is the sign bit
const EVENT_ID = { [LISTEN.CELL_LOCATION]: 5, [LISTEN.CELL_INFO]: 11, [LISTEN.REGISTRATION_FAILURE]: 31, [LISTEN.BARRING_INFO]: 32 };
const INTERFACES = {   // TelephonyCallback.<name>: LISTEN flag, method on the interface
  CallStateListener: [LISTEN.CALL_STATE, 'onCallStateChanged', '(I)V'], DataConnectionStateListener: [LISTEN.DATA_CONNECTION_STATE, 'onDataConnectionStateChanged', '(II)V'],
  DataActivityListener: [LISTEN.DATA_ACTIVITY, 'onDataActivity', '(I)V'], CellLocationListener: [LISTEN.CELL_LOCATION, 'onCellLocationChanged', `(${CELL_LOCATION})V`],
  MessageWaitingIndicatorListener: [LISTEN.MESSAGE_WAITING, 'onMessageWaitingIndicatorChanged', '(Z)V'], CallForwardingIndicatorListener: [LISTEN.CALL_FORWARDING, 'onCallForwardingIndicatorChanged', '(Z)V'],
  UserMobileDataStateListener: [LISTEN.USER_MOBILE_DATA_STATE, 'onUserMobileDataStateChanged', '(Z)V'], ActiveDataSubscriptionIdListener: [LISTEN.ACTIVE_DATA_SUBSCRIPTION_ID_CHANGE, 'onActiveDataSubscriptionIdChanged', '(I)V'],
  CellInfoListener: [LISTEN.CELL_INFO, 'onCellInfoChanged', `(${LIST})V`], ServiceStateListener: [LISTEN.SERVICE_STATE, 'onServiceStateChanged', '(Landroid/telephony/ServiceState;)V'],
  SignalStrengthsListener: [LISTEN.SIGNAL_STRENGTHS, 'onSignalStrengthsChanged', '(Landroid/telephony/SignalStrength;)V'], DisplayInfoListener: [LISTEN.DISPLAY_INFO_CHANGED, 'onDisplayInfoChanged', '(Landroid/telephony/TelephonyDisplayInfo;)V'] };

export function createTelephonyHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? values : [receiver, ...values], mode);
  const onMobile = () => platform.device?.connectivity === 'metered';
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1);
  const uid = () => platform.virtualProcess.uid;
  const npe = r => r.throwJava('Ljava/lang/NullPointerException;', null);
  const nullish = value => value === null || value === undefined || value === 0;
  const holds = (r, permission) => !!platform.holdsPermission?.(r, permission);
  const securityException = (r, text) => r.throwJava('Ljava/lang/SecurityException;', text);

  // ---- PhoneStateListener (public class apps subclass) and TelephonyCallback with its listener interfaces
  type(LISTENER, OBJECT, [], { allocatable: true });
  for (const [name, value] of Object.entries(LISTEN)) staticField(LISTENER, `LISTEN_${name}`, 'I', () => value | 0);
  staticField(LISTENER, 'LISTEN_NONE', 'I', () => 0);
  def(LISTENER, '<init>', '()V', (r, _m, [self]) => { r.object(self).executor = null; });
  def(LISTENER, '<init>', `(${EXECUTOR})V`, (r, _m, [self, executor]) => {
    if (nullish(executor)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'PhoneStateListener Executor must be non-null');
    r.object(self).executor = executor;
  });
  for (const [name, signature] of [['onServiceStateChanged', '(Landroid/telephony/ServiceState;)V'], ['onSignalStrengthChanged', '(I)V'], ['onMessageWaitingIndicatorChanged', '(Z)V'], ['onCallForwardingIndicatorChanged', '(Z)V'],
    ['onCellLocationChanged', `(${CELL_LOCATION})V`], ['onCallStateChanged', `(I${STRING})V`], ['onDataConnectionStateChanged', '(I)V'], ['onDataConnectionStateChanged', '(II)V'], ['onDataActivity', '(I)V'],
    ['onSignalStrengthsChanged', '(Landroid/telephony/SignalStrength;)V'], ['onCellInfoChanged', `(${LIST})V`], ['onCallDisconnectCauseChanged', '(II)V'], ['onUserMobileDataStateChanged', '(Z)V'],
    ['onDisplayInfoChanged', '(Landroid/telephony/TelephonyDisplayInfo;)V'], ['onActiveDataSubscriptionIdChanged', '(I)V']])
    def(LISTENER, name, signature, () => {});   // the public base-class bodies are empty
  type(CALLBACK, OBJECT, [], { allocatable: true });
  def(CALLBACK, '<init>', '()V', () => {});
  for (const name of Object.keys(INTERFACES)) type(`${CALLBACK}`.replace(';', `$${name};`), OBJECT);

  // ---- delivery: a Runnable that runs a platform closure, handed to the registered Executor (TelephonyCallback) or the platform task queue (PhoneStateListener without Executor)
  type(DELIVERY, OBJECT, [RUNNABLE], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => r.object(self).task());
  const emptyList = r => { const list = r.allocate('Ljava/util/ArrayList;'); call(r, list, 'Ljava/util/ArrayList;', '<init>', [], 'V', [], 'direct'); return list; };
  const emptyCellLocation = r => { const location = r.allocate(GSM_CELL_LOCATION); call(r, location, GSM_CELL_LOCATION, '<init>', [], 'V', [], 'direct'); return location; };

  const listeners = () => (platform.phoneListeners ??= []);
  const dataState = () => (onMobile() ? 2 : 0), networkType = () => (onMobile() ? 13 : 0);   // DATA_CONNECTED / DATA_DISCONNECTED, NETWORK_TYPE_LTE / UNKNOWN: device-state-host's view
  // One row per event a listener can register for: how PhoneStateListener and the matching TelephonyCallback interface receive the initial / changed value.
  const EVENTS = [
    [LISTEN.SIGNAL_STRENGTH, (r, t) => call(r, t, LISTENER, 'onSignalStrengthChanged', ['I'], 'V', [99]), null],   // getGsmSignalStrength() of "no signal": 99
    [LISTEN.MESSAGE_WAITING, (r, t) => call(r, t, LISTENER, 'onMessageWaitingIndicatorChanged', ['Z'], 'V', [0]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$MessageWaitingIndicatorListener;`, 'onMessageWaitingIndicatorChanged', ['Z'], 'V', [0])],
    [LISTEN.CALL_FORWARDING, (r, t) => call(r, t, LISTENER, 'onCallForwardingIndicatorChanged', ['Z'], 'V', [0]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$CallForwardingIndicatorListener;`, 'onCallForwardingIndicatorChanged', ['Z'], 'V', [0])],
    [LISTEN.CELL_LOCATION, (r, t) => call(r, t, LISTENER, 'onCellLocationChanged', [CELL_LOCATION], 'V', [emptyCellLocation(r)]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$CellLocationListener;`, 'onCellLocationChanged', [CELL_LOCATION], 'V', [emptyCellLocation(r)])],
    [LISTEN.CALL_STATE, (r, t) => call(r, t, LISTENER, 'onCallStateChanged', ['I', STRING], 'V', [0, '']), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$CallStateListener;`, 'onCallStateChanged', ['I'], 'V', [0])],
    [LISTEN.DATA_CONNECTION_STATE, (r, t) => { call(r, t, LISTENER, 'onDataConnectionStateChanged', ['I', 'I'], 'V', [dataState(), networkType()]); call(r, t, LISTENER, 'onDataConnectionStateChanged', ['I'], 'V', [dataState()]); },
      (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$DataConnectionStateListener;`, 'onDataConnectionStateChanged', ['I', 'I'], 'V', [dataState(), networkType()])],
    [LISTEN.DATA_ACTIVITY, (r, t) => call(r, t, LISTENER, 'onDataActivity', ['I'], 'V', [0]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$DataActivityListener;`, 'onDataActivity', ['I'], 'V', [0])],
    [LISTEN.CELL_INFO, (r, t) => call(r, t, LISTENER, 'onCellInfoChanged', [LIST], 'V', [emptyList(r)]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$CellInfoListener;`, 'onCellInfoChanged', [LIST], 'V', [emptyList(r)])],
    [LISTEN.USER_MOBILE_DATA_STATE, (r, t) => call(r, t, LISTENER, 'onUserMobileDataStateChanged', ['Z'], 'V', [onMobile() ? 1 : 0]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$UserMobileDataStateListener;`, 'onUserMobileDataStateChanged', ['Z'], 'V', [onMobile() ? 1 : 0])],
    [LISTEN.ACTIVE_DATA_SUBSCRIPTION_ID_CHANGE, (r, t) => call(r, t, LISTENER, 'onActiveDataSubscriptionIdChanged', ['I'], 'V', [-1]), (r, t) => call(r, t, `${CALLBACK.slice(0, -1)}$ActiveDataSubscriptionIdListener;`, 'onActiveDataSubscriptionIdChanged', ['I'], 'V', [-1])],
  ];
  const deliverable = new Set(EVENTS.map(([flag]) => flag));

  /** Runs `task` the way the registered listener is called: through its Executor, or from the platform task queue on the main thread. */
  const post = (r, entry, task) => {
    if (!listeners().includes(entry)) return;
    const run = () => { if (listeners().includes(entry)) task(); };
    if (entry.executor) { const runnable = r.allocate(DELIVERY); r.object(runnable).task = run; call(r, entry.executor, EXECUTOR, 'execute', [RUNNABLE], 'V', [runnable]); } else platform.queueTask(run, 0, [entry.target, entry.executor]);
  };
  const notify = (r, entry, only = null) => {
    for (const [flag, viaListener, viaCallback] of EVENTS) {
      if (!(entry.events & flag) || (only && !only.includes(flag))) continue;
      const handler = entry.kind === 'callback' ? viaCallback : viaListener;
      if (handler) post(r, entry, () => handler(r, entry.target));
    }
  };

  // ---- TelephonyRegistry.checkListenerPermission (android-13.0.0_r1) for the events the VM supports
  const checkListenerPermission = (r, events) => {
    const locationEvents = [LISTEN.CELL_LOCATION, LISTEN.CELL_INFO, LISTEN.REGISTRATION_FAILURE, LISTEN.BARRING_INFO].filter(flag => events & flag);
    if (locationEvents.length && !holds(r, FINE) && !(targetSdk() < Q && holds(r, COARSE)))   // DENIED_HARD: fine location from Q on, coarse is enough before
      securityException(r, `Unable to listen for events [${locationEvents.map(flag => EVENT_ID[flag]).sort((a, b) => a - b).join(', ')}] due to insufficient location permissions.`);
    const phoneState = (events & (LISTEN.CALL_FORWARDING | LISTEN.MESSAGE_WAITING)) || (targetSdk() >= S && (events & (LISTEN.CALL_STATE | LISTEN.CELL_INFO | LISTEN.ACTIVE_DATA_SUBSCRIPTION_ID_CHANGE)))
      || (targetSdk() < S && (events & LISTEN.DISPLAY_INFO_CHANGED));
    if (phoneState && !holds(r, READ_PHONE_STATE)) securityException(r, `listen: uid ${uid()} does not have ${READ_PHONE_STATE}.`);   // TelephonyPermissions.checkReadPhoneState -> Context.enforcePermission
    if (events & (LISTEN.PRECISE_CALL_STATE | LISTEN.PRECISE_DATA_CONNECTION_STATE | LISTEN.CALL_DISCONNECT_CAUSES | LISTEN.IMS_CALL_DISCONNECT_CAUSES))
      securityException(r, `Neither user ${uid()} nor current process has android.permission.READ_PRECISE_PHONE_STATE.`);   // no carrier privileges either
    if (events & LISTEN.EMERGENCY_NUMBER_LIST) { if (!holds(r, READ_PHONE_STATE)) securityException(r, `listen: uid ${uid()} does not have ${READ_PHONE_STATE}.`); }
  };
  const register = (r, target, events, kind, executor) => {
    checkListenerPermission(r, events);
    const list = listeners(), existing = list.findIndex(entry => entry.target.ref === target.ref);
    if (existing >= 0) list.splice(existing, 1);
    if (!events) return;
    const entry = { target, events, kind, executor: executor ?? null }; list.push(entry);
    const unsupported = events & ~[...deliverable].reduce((mask, flag) => mask | flag, 0);
    if (unsupported) r.record(`TELEPHONY listener events 0x${(unsupported >>> 0).toString(16)} are registered but never delivered [ServiceState / SignalStrength / precise-state objects are not available in the browser VM]`);
    notify(r, entry);
  };
  platform.telephonyHost = { connectivityChanged(r) {   // the device panel moved between Wi-Fi and mobile data: data state and the mobile-data flag changed
    for (const entry of [...listeners()]) notify(r, entry, [LISTEN.DATA_CONNECTION_STATE, LISTEN.USER_MOBILE_DATA_STATE]);
  } };

  def(TM, 'listen', `(${LISTENER}I)V`, (r, _m, [, listener, events]) => {   // TelephonyManager.listen -> listenFromListener: a null listener is dereferenced
    if (nullish(listener)) npe(r);
    register(r, listener, events | 0, 'listener', r.object(listener).executor ?? null);
  });
  const interfaceEvents = (r, callback) => Object.entries(INTERFACES).reduce((mask, [name, [flag]]) => (r.isSubtype(r.typeOf(callback), `${CALLBACK.slice(0, -1)}$${name};`) ? mask | flag : mask), 0);
  const registerCallback = (r, executor, callback) => {
    if (nullish(executor) || nullish(callback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'TelephonyCallback and executor must be non-null');
    register(r, callback, interfaceEvents(r, callback), 'callback', executor);
    r.object(callback).registered = true;
  };
  def(TM, 'registerTelephonyCallback', `(${EXECUTOR}${CALLBACK})V`, (r, _m, [, executor, callback]) => registerCallback(r, executor, callback));
  def(TM, 'registerTelephonyCallback', `(I${EXECUTOR}${CALLBACK})V`, (r, _m, [, , executor, callback]) => registerCallback(r, executor, callback));
  def(TM, 'unregisterTelephonyCallback', `(${CALLBACK})V`, (r, _m, [, callback]) => {
    if (nullish(callback)) npe(r);
    if (!r.object(callback).registered) return;                    // callback.callback == null: never registered
    const list = listeners(), index = list.findIndex(entry => entry.target.ref === callback.ref); if (index >= 0) list.splice(index, 1);
    r.object(callback).registered = false;
  });

  // ---- plain queries of an offline phone
  def(TM, 'getCallState', '()I', () => 0); def(TM, 'getCallStateForSubscription', '()I', () => 0);   // CALL_STATE_IDLE
  def(TM, 'getDataState', '()I', () => dataState()); def(TM, 'getDataActivity', '()I', () => 0);    // DATA_ACTIVITY_NONE
  def(TM, 'getDataNetworkType', '()I', () => networkType()); def(TM, 'getVoiceNetworkType', '()I', () => networkType());
  def(TM, 'hasIccCard', '()Z', () => 1); def(TM, 'getSimState', '(I)I', () => 5);
  for (const name of ['isSmsCapable', 'isDeviceSmsCapable', 'isDeviceVoiceCapable', 'isDataCapable', 'isManualNetworkSelectionAllowed']) def(TM, name, '()Z', () => 1);
  for (const name of ['isWorldPhone', 'isTtyModeSupported', 'isRttSupported', 'isHearingAidCompatibilitySupported', 'canChangeDtmfToneLength', 'isDataRoamingEnabled']) def(TM, name, '()Z', () => 0);
  def(TM, 'isDataConnectionAllowed', '()Z', () => (onMobile() ? 1 : 0)); def(TM, 'getSupportedModemCount', '()I', () => 1);
  def(TM, 'getSubscriptionId', '()I', () => -1);                    // SubscriptionManager.getDefaultSubscriptionId() with no subscription (system-managers-host)
  def(TM, 'createForSubscriptionId', `(I)${TM}`, (_r, _m, [self]) => self);
  def(TM, 'getSimCarrierId', '()I', () => -1); def(TM, 'getSimSpecificCarrierId', '()I', () => -1); def(TM, 'getCarrierIdFromSimMccMnc', '()I', () => -1);   // UNKNOWN_CARRIER_ID
  def(TM, 'getSimCarrierIdName', '()Ljava/lang/CharSequence;', () => null); def(TM, 'getSimSpecificCarrierIdName', '()Ljava/lang/CharSequence;', () => null);
  def(TM, 'getNetworkSelectionMode', '()I', () => 1);               // NETWORK_SELECTION_MODE_AUTO
  def(TM, 'getMmsUserAgent', `()${STRING}`, () => 'Android'); def(TM, 'getMmsUAProfUrl', `()${STRING}`, () => null);
  def(TM, 'getNetworkSpecifier', `()${STRING}`, () => '');
  def(TM, 'getEquivalentHomePlmns', `()${LIST}`, r => emptyList(r));
  def(TM, 'getCellLocation', `()${CELL_LOCATION}`, r => {           // PhoneInterfaceManager.getCellLocation: DENIED_HARD throws; with no cell the location is empty and TelephonyManager answers null
    if (!holds(r, FINE) && !(targetSdk() < Q && holds(r, COARSE))) securityException(r, 'Not allowed to access cell location');
    return null;
  });
  def(TM, 'getAllCellInfo', `()${LIST}`, r => {
    if (!holds(r, FINE) && !(targetSdk() < Q && holds(r, COARSE))) securityException(r, 'Not allowed to access cell info');
    return emptyList(r);
  });
  // Device identifiers: TelephonyPermissions.checkCallingOrSelfReadDeviceIdentifiers. An ordinary app is refused from Q on; before Q READ_PHONE_STATE suffices and the value is null
  // because this phone has no radio identifiers to report.
  const identifier = name => (r) => {
    if (targetSdk() >= Q || !holds(r, READ_PHONE_STATE)) securityException(r, `${platform.packageName}: The user ${uid()} does not meet the requirements to access device identifiers.`);
    return null;
  };
  for (const name of ['getDeviceId', 'getImei', 'getMeid', 'getTypeAllocationCode', 'getManufacturerCode', 'getNai', 'getPrimaryImei', 'getSubscriberId', 'getSimSerialNumber', 'getGroupIdLevel1', 'getDeviceSoftwareVersion']) {
    def(TM, name, `()${STRING}`, identifier(name));
    if (!['getSubscriberId', 'getSimSerialNumber', 'getGroupIdLevel1', 'getDeviceSoftwareVersion', 'getNai', 'getPrimaryImei'].includes(name)) def(TM, name, `(I)${STRING}`, identifier(name));
  }
  def(TM, 'getLine1Number', `()${STRING}`, r => {                   // READ_PHONE_STATE, READ_SMS or READ_PHONE_NUMBERS; the SIM carries no stored number
    if (![READ_PHONE_STATE, READ_SMS, READ_PHONE_NUMBERS].some(permission => holds(r, permission))) securityException(r, `getLine1Number: Neither user ${uid()} nor current process has ${READ_PHONE_STATE}, ${READ_SMS}, or ${READ_PHONE_NUMBERS}.`);
    return '';
  });
  for (const name of ['getVoiceMailNumber', 'getVoiceMailAlphaTag']) def(TM, name, `()${STRING}`, r => { if (!holds(r, READ_PHONE_STATE)) securityException(r, `${name}: Neither user ${uid()} nor current process has ${READ_PHONE_STATE}.`); return null; });

  // ---- CellLocation / GsmCellLocation (the original bodies)
  type(CELL_LOCATION, OBJECT, [], { allocatable: false });
  def(CELL_LOCATION, 'requestLocationUpdate', '()V', () => {}, { static: true });                // no phone process to ask: nothing is updated
  def(CELL_LOCATION, 'getEmpty', `()${CELL_LOCATION}`, r => emptyCellLocation(r), { static: true });   // PHONE_TYPE_GSM
  def(CELL_LOCATION, 'newFromBundle', `(${BUNDLE})${CELL_LOCATION}`, (r, _m, [bundle]) => { const location = r.allocate(GSM_CELL_LOCATION); call(r, location, GSM_CELL_LOCATION, '<init>', [BUNDLE], 'V', [bundle], 'direct'); return location; }, { static: true });
  type(GSM_CELL_LOCATION, CELL_LOCATION, [], { allocatable: true });
  const gsm = (r, self) => r.object(self);
  def(GSM_CELL_LOCATION, '<init>', '()V', (r, _m, [self]) => Object.assign(gsm(r, self), { lac: -1, cid: -1, psc: -1 }));
  def(GSM_CELL_LOCATION, '<init>', `(${BUNDLE})V`, (r, _m, [self, bundle]) => {
    if (nullish(bundle)) npe(r);
    const get = key => call(r, bundle, BUNDLE, 'getInt', [STRING, 'I'], 'I', [key, -1]);
    Object.assign(gsm(r, self), { lac: get('lac'), cid: get('cid'), psc: get('psc') });
  });
  def(GSM_CELL_LOCATION, 'getLac', '()I', (r, _m, [self]) => gsm(r, self).lac); def(GSM_CELL_LOCATION, 'getCid', '()I', (r, _m, [self]) => gsm(r, self).cid); def(GSM_CELL_LOCATION, 'getPsc', '()I', (r, _m, [self]) => gsm(r, self).psc);
  def(GSM_CELL_LOCATION, 'setStateInvalid', '()V', (r, _m, [self]) => Object.assign(gsm(r, self), { lac: -1, cid: -1, psc: -1 }));
  def(GSM_CELL_LOCATION, 'setLacAndCid', '(II)V', (r, _m, [self, lac, cid]) => Object.assign(gsm(r, self), { lac, cid })); def(GSM_CELL_LOCATION, 'setPsc', '(I)V', (r, _m, [self, psc]) => { gsm(r, self).psc = psc; });
  def(GSM_CELL_LOCATION, 'hashCode', '()I', (r, _m, [self]) => gsm(r, self).lac ^ gsm(r, self).cid);
  def(GSM_CELL_LOCATION, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => (!nullish(other) && r.isSubtype(r.typeOf(other), GSM_CELL_LOCATION) && ['lac', 'cid', 'psc'].every(field => gsm(r, self)[field] === gsm(r, other)[field]) ? 1 : 0));
  def(GSM_CELL_LOCATION, 'toString', `()${STRING}`, (r, _m, [self]) => `[${gsm(r, self).lac},${gsm(r, self).cid},${gsm(r, self).psc}]`);
  def(GSM_CELL_LOCATION, 'fillInNotifierBundle', `(${BUNDLE})V`, (r, _m, [self, bundle]) => { for (const key of ['lac', 'cid', 'psc']) call(r, bundle, BUNDLE, 'putInt', [STRING, 'I'], 'V', [key, gsm(r, self)[key]]); });
  def(GSM_CELL_LOCATION, 'isEmpty', '()Z', (r, _m, [self]) => (gsm(r, self).lac === -1 && gsm(r, self).cid === -1 && gsm(r, self).psc === -1 ? 1 : 0));
  return { ...registry };
}
