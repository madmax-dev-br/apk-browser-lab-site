import { createHostRegistry } from './host-contract.js?v=e0bbabac13b9';
import { gcRoot } from './heap-gc.js?v=e0bbabac13b9';

// android.net.NetworkInfo (android-13.0.0_r1, deprecated since API 29) with its State and DetailedState enums, built from the lab's connectivity model: the virtual device has a Wi-Fi radio
// (TYPE_WIFI, SSID of the virtual access point) and a mobile radio (TYPE_MOBILE, LTE), and platform.device.connectivity says which one carries the default network ('online' = Wi-Fi, any other
// value but 'offline' = mobile, 'offline' = none). The radio that does not carry the default network reports DISCONNECTED/DISCONNECTED; with no default network getActiveNetworkInfo() is null,
// exactly like ConnectivityManager when there is no default network, and getNetworkInfo(type) / getAllNetworkInfo() answer disconnected infos.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', NET_INFO = 'Landroid/net/NetworkInfo;', STATE = 'Landroid/net/NetworkInfo$State;', DETAILED = 'Landroid/net/NetworkInfo$DetailedState;';
const NETWORK = 'Landroid/net/Network;', CONNECTIVITY = 'Landroid/net/ConnectivityManager;', PARCEL = 'Landroid/os/Parcel;', CREATOR = 'Landroid/os/Parcelable$Creator;', PARCELABLE = 'Landroid/os/Parcelable;';
export const STATES = ['CONNECTED', 'CONNECTING', 'DISCONNECTED', 'DISCONNECTING', 'SUSPENDED', 'UNKNOWN'];
export const DETAILED_STATES = ['IDLE', 'SCANNING', 'CONNECTING', 'AUTHENTICATING', 'OBTAINING_IPADDR', 'CONNECTED', 'SUSPENDED', 'DISCONNECTING', 'DISCONNECTED', 'FAILED', 'BLOCKED', 'VERIFYING_POOR_LINK', 'CAPTIVE_PORTAL_CHECK'];
/** NetworkInfo.stateMap: the coarse State of every DetailedState. */
export const STATE_MAP = { IDLE: 'DISCONNECTED', SCANNING: 'DISCONNECTED', CONNECTING: 'CONNECTING', AUTHENTICATING: 'CONNECTING', OBTAINING_IPADDR: 'CONNECTING', VERIFYING_POOR_LINK: 'CONNECTING', CAPTIVE_PORTAL_CHECK: 'CONNECTING', CONNECTED: 'CONNECTED', SUSPENDED: 'SUSPENDED', DISCONNECTING: 'DISCONNECTING', DISCONNECTED: 'DISCONNECTED', FAILED: 'DISCONNECTED', BLOCKED: 'DISCONNECTED' };
const TYPE_NONE = -1, TYPE_MOBILE = 0, TYPE_WIFI = 1, MAX_NETWORK_TYPE = 17;   // ConnectivityManager.MAX_NETWORK_TYPE = TYPE_VPN
const WIFI_SSID = '"AndroidWifi"', LTE = 13;

export function createNetworkInfoHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const nullish = v => v === null || v === undefined || v === 0;
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);

  // ---- enums ------------------------------------------------------------------------------------------------------------------------------
  type(NET_INFO, OBJECT, [PARCELABLE], { allocatable: true }); type(STATE, 'Ljava/lang/Enum;', [], { allocatable: true }); type(DETAILED, 'Ljava/lang/Enum;', [], { allocatable: true });
  const tables = new WeakMap();
  const constant = (r, owner, names, name) => {
    const table = tables.get(r) ?? tables.set(r, gcRoot(new Map())).get(r), key = owner + name;
    if (!table.has(key)) { const value = r.allocate(owner), o = r.object(value); o.enumName = name; o.enumOrdinal = names.indexOf(name); table.set(key, value); }
    return table.get(key);
  };
  for (const [owner, names] of [[STATE, STATES], [DETAILED, DETAILED_STATES]]) {
    for (const name of names) staticField(owner, name, owner, r => constant(r, owner, names, name));
    def(owner, 'values', `()[${owner}`, r => { const array = r.newArray(`[${owner}`, names.length); r.array(array).elements = names.map(name => constant(r, owner, names, name)); return array; }, { static: true });
    def(owner, 'valueOf', `(${STRING})${owner}`, (r, _m, [name]) => {
      if (nullish(name)) r.throwJava('Ljava/lang/NullPointerException;', 'Name is null');
      const wanted = text(r, name); if (!names.includes(wanted)) r.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant ${owner.slice(1, -1).replaceAll('/', '.').replace('$', '.')}.${wanted}`);
      return constant(r, owner, names, wanted);
    }, { static: true });
  }

  // ---- NetworkInfo --------------------------------------------------------------------------------------------------------------------------
  const state = (r, self) => r.object(self).networkInfo ?? r.throwJava('Ljava/lang/IllegalStateException;', 'NetworkInfo used before construction');
  const setDetailed = (info, detailed, reason, extra) => { info.detailed = detailed; info.state = STATE_MAP[detailed]; info.reason = reason; info.extra = extra; };
  const initialise = (r, self, networkType, subtype, typeName, subtypeName) => {
    if (!(networkType >= 0 && networkType <= MAX_NETWORK_TYPE) && networkType !== TYPE_NONE) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid network type: ${networkType}`);
    const info = r.object(self).networkInfo = { type: networkType, subtype, typeName: text(r, typeName), subtypeName: text(r, subtypeName), detailed: 'IDLE', state: 'UNKNOWN', reason: null, extra: null, failover: false, available: false, roaming: false };
    setDetailed(info, 'IDLE', null, null); info.state = 'UNKNOWN';
  };
  def(NET_INFO, '<init>', `(II${STRING}${STRING})V`, (r, _m, [self, networkType, subtype, typeName, subtypeName]) => initialise(r, self, networkType, subtype, typeName, subtypeName));
  def(NET_INFO, '<init>', `(${NET_INFO})V`, (r, _m, [self, source]) => { if (!nullish(source)) r.object(self).networkInfo = { ...state(r, source) }; });
  def(NET_INFO, 'getType', '()I', (r, _m, [self]) => state(r, self).type);
  def(NET_INFO, 'getSubtype', '()I', (r, _m, [self]) => state(r, self).subtype);
  def(NET_INFO, 'getTypeName', `()${STRING}`, (r, _m, [self]) => state(r, self).typeName);
  def(NET_INFO, 'getSubtypeName', `()${STRING}`, (r, _m, [self]) => state(r, self).subtypeName);
  def(NET_INFO, 'getState', `()${STATE}`, (r, _m, [self]) => constant(r, STATE, STATES, state(r, self).state));
  def(NET_INFO, 'getDetailedState', `()${DETAILED}`, (r, _m, [self]) => constant(r, DETAILED, DETAILED_STATES, state(r, self).detailed));
  def(NET_INFO, 'getReason', `()${STRING}`, (r, _m, [self]) => state(r, self).reason);
  def(NET_INFO, 'getExtraInfo', `()${STRING}`, (r, _m, [self]) => state(r, self).extra);
  def(NET_INFO, 'isConnected', '()Z', (r, _m, [self]) => state(r, self).state === 'CONNECTED' ? 1 : 0);
  def(NET_INFO, 'isConnectedOrConnecting', '()Z', (r, _m, [self]) => ['CONNECTED', 'CONNECTING'].includes(state(r, self).state) ? 1 : 0);
  def(NET_INFO, 'isAvailable', '()Z', (r, _m, [self]) => state(r, self).available ? 1 : 0);
  def(NET_INFO, 'isFailover', '()Z', (r, _m, [self]) => state(r, self).failover ? 1 : 0);
  def(NET_INFO, 'isRoaming', '()Z', (r, _m, [self]) => state(r, self).roaming ? 1 : 0);
  def(NET_INFO, 'setIsAvailable', '(Z)V', (r, _m, [self, value]) => { state(r, self).available = !!value; });
  def(NET_INFO, 'setFailover', '(Z)V', (r, _m, [self, value]) => { state(r, self).failover = !!value; });
  def(NET_INFO, 'setRoaming', '(Z)V', (r, _m, [self, value]) => { state(r, self).roaming = !!value; });
  def(NET_INFO, 'setSubtype', `(I${STRING})V`, (r, _m, [self, subtype, subtypeName]) => { const info = state(r, self); info.subtype = subtype; info.subtypeName = text(r, subtypeName); });
  def(NET_INFO, 'setDetailedState', `(${DETAILED}${STRING}${STRING})V`, (r, _m, [self, detailed, reason, extra]) => { const name = r.object(detailed).enumName; setDetailed(state(r, self), name, text(r, reason), text(r, extra)); });
  def(NET_INFO, 'setExtraInfo', `(${STRING})V`, (r, _m, [self, extra]) => { state(r, self).extra = text(r, extra); });
  def(NET_INFO, 'describeContents', '()I', () => 0);
  def(NET_INFO, 'toString', `()${STRING}`, (r, _m, [self]) => { const i = state(r, self); return `[type: ${i.typeName}[${i.subtypeName}], state: ${i.state}/${i.detailed}, reason: ${i.reason ?? '(unspecified)'}, extra: ${i.extra ?? '(none)'}, failover: ${i.failover}, available: ${i.available}, roaming: ${i.roaming}]`; });
  // Parcel layout of NetworkInfo.writeToParcel: type, subtype, type name, subtype name, State name, DetailedState name, failover, available, roaming, reason, extra info.
  def(NET_INFO, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, parcel]) => {
    const i = state(r, self), p = (name, parameters, args) => call(r, parcel, PARCEL, name, parameters, 'V', args);
    p('writeInt', ['I'], [i.type]); p('writeInt', ['I'], [i.subtype]); p('writeString', [STRING], [i.typeName]); p('writeString', [STRING], [i.subtypeName]); p('writeString', [STRING], [i.state]); p('writeString', [STRING], [i.detailed]);
    p('writeInt', ['I'], [i.failover ? 1 : 0]); p('writeInt', ['I'], [i.available ? 1 : 0]); p('writeInt', ['I'], [i.roaming ? 1 : 0]); p('writeString', [STRING], [i.reason]); p('writeString', [STRING], [i.extra]);
  });
  const CREATOR_TYPE = 'Landroid/net/NetworkInfo$1;';
  type(CREATOR_TYPE, OBJECT, [CREATOR], { allocatable: true });
  def(CREATOR_TYPE, 'createFromParcel', `(${PARCEL})${OBJECT}`, (r, _m, [, parcel]) => {
    const q = (name, result) => call(r, parcel, PARCEL, name, [], result), self = r.allocate(NET_INFO);
    const networkType = q('readInt', 'I'), subtype = q('readInt', 'I'), typeName = q('readString', STRING), subtypeName = q('readString', STRING);
    initialise(r, self, networkType, subtype, typeName, subtypeName);
    const info = state(r, self); info.state = text(r, q('readString', STRING)); info.detailed = text(r, q('readString', STRING));
    info.failover = q('readInt', 'I') !== 0; info.available = q('readInt', 'I') !== 0; info.roaming = q('readInt', 'I') !== 0; info.reason = text(r, q('readString', STRING)); info.extra = text(r, q('readString', STRING));
    return self;
  });
  def(CREATOR_TYPE, 'newArray', `(I)[${OBJECT}`, (r, _m, [, size]) => { if (size < 0) r.throwJava('Ljava/lang/NegativeArraySizeException;', String(size)); return r.newArray(`[${NET_INFO}`, size); });
  staticField(NET_INFO, 'CREATOR', CREATOR, r => r.allocate(CREATOR_TYPE));

  // ---- the lab's connectivity model -------------------------------------------------------------------------------------------------------------
  const carrier = () => { const connectivity = platform.device.connectivity; return connectivity === 'offline' ? null : connectivity === 'online' ? TYPE_WIFI : TYPE_MOBILE; };
  /** A NetworkInfo for one of the device's radios the way ConnectivityService builds it: connected when that radio carries the default network, disconnected (and still available) otherwise. */
  const radioInfo = (r, radio) => {
    const info = r.allocate(NET_INFO), connected = carrier() === radio;
    initialise(r, info, radio, radio === TYPE_WIFI ? 0 : LTE, radio === TYPE_WIFI ? 'WIFI' : 'MOBILE', radio === TYPE_WIFI ? '' : 'LTE');
    const record = r.object(info).networkInfo; setDetailed(record, connected ? 'CONNECTED' : 'DISCONNECTED', null, connected ? (radio === TYPE_WIFI ? WIFI_SSID : 'internet') : null); record.available = true;
    return info;
  };
  const transportOf = (r, network) => r.object(network).transport === 1 ? TYPE_WIFI : TYPE_MOBILE;
  def(CONNECTIVITY, 'getActiveNetworkInfo', `()${NET_INFO}`, r => { const radio = carrier(); return radio === null ? null : radioInfo(r, radio); });
  def(CONNECTIVITY, 'getNetworkInfo', `(${NETWORK})${NET_INFO}`, (r, _m, [, network]) => { if (nullish(network)) return null; const radio = carrier(); return radio !== null && transportOf(r, network) === radio ? radioInfo(r, radio) : null; });
  def(CONNECTIVITY, 'getNetworkInfo', `(I)${NET_INFO}`, (r, _m, [, networkType]) => networkType === TYPE_MOBILE || networkType === TYPE_WIFI ? radioInfo(r, networkType) : null);
  def(CONNECTIVITY, 'getAllNetworkInfo', `()[${NET_INFO}`, r => { const array = r.newArray(`[${NET_INFO}`, 2); r.array(array).elements = [radioInfo(r, TYPE_MOBILE), radioInfo(r, TYPE_WIFI)]; return array; });
  def(CONNECTIVITY, 'isNetworkTypeValid', '(I)Z', (r, _m, [networkType]) => networkType >= 0 && networkType <= MAX_NETWORK_TYPE ? 1 : 0, { static: true });
  /** The NetworkInfo and the radio the CONNECTIVITY_ACTION broadcast describes when the default network changes from `previous` to the current one. */
  registry.connectivityBroadcastInfo = (r, previousConnectivity) => {
    const radio = carrier();
    if (radio !== null) return { current: radioInfo(r, radio), type: radio };
    const was = previousConnectivity === 'online' ? TYPE_WIFI : TYPE_MOBILE;
    return { current: radioInfo(r, was), type: was };
  };
  return registry;
}
