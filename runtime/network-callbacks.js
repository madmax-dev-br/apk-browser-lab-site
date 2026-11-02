// ConnectivityManager network callbacks and requests (android-13.0.0_r1 ConnectivityManager.java, NetworkRequest.java, NetworkCapabilities.java, LinkProperties.java) over the device panel's
// connectivity model: at most one active network (Wi-Fi unmetered, mobile metered), none when offline. Registered callbacks hear what a callback on that device hears, asynchronously on the
// Handler given (or the platform task queue), in the platform's order: onAvailable, onCapabilitiesChanged, onLinkPropertiesChanged, onBlockedStatusChanged; onLost when the network goes.
// There is no IP configuration to read in the browser VM, so LinkProperties carries the interface name and empty address / route / DNS lists, never invented ones.
const DELIVERY = 'Lapkweb/bridge/TelephonyDelivery;';   // the Runnable that runs a platform closure (declared by telephony-host.js)
const LINK_PROPERTIES = 'Landroid/net/LinkProperties;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;', HANDLER = 'Landroid/os/Handler;', RUNNABLE = 'Ljava/lang/Runnable;';
const MAX_TRANSPORT = 8, MAX_CAPABILITY = 35;

export function installNetworkCallbacks({ platform, registry, activeNetwork, capabilitiesFor, call, names, entries }) {
  const { def, type } = registry, { CONNECTIVITY, NETWORK, CAPABILITIES, CALLBACK, REQUEST, REQUEST_BUILDER } = names;
  const nullish = value => value === null || value === undefined || value === 0;
  type(LINK_PROPERTIES, 'Ljava/lang/Object;', [], { allocatable: true }); type(REQUEST, 'Ljava/lang/Object;', [], { allocatable: true }); type(REQUEST_BUILDER, 'Ljava/lang/Object;', [], { allocatable: true });
  // what the model's networks hold (NetworkCapabilities.hasCapability): INTERNET, NOT_RESTRICTED, TRUSTED, NOT_VPN, VALIDATED, NOT_ROAMING, FOREGROUND, NOT_CONGESTED, NOT_SUSPENDED, and NOT_METERED on Wi-Fi
  const holds = (caps, capability) => (capability === 11 ? (caps.metered ? 0 : 1) : [12, 13, 14, 15, 16, 18, 19, 20, 21].includes(capability) ? 1 : 0);
  const satisfies = (request, caps) => { const wanted = request ?? { capabilities: new Set(), transports: new Set() }; return [...wanted.capabilities].every(c => holds(caps, c)) && (wanted.transports.size === 0 || wanted.transports.has(caps.transport)); };
  const range = (r, value, max, label) => { if (value < 0 || value > max) r.throwJava('Ljava/lang/IllegalArgumentException;', `${label} ${value} out of range`); };

  // ---- NetworkRequest / NetworkRequest.Builder
  def(REQUEST_BUILDER, '<init>', '()V', (r, _m, [self]) => { r.object(self).request = { capabilities: new Set(), transports: new Set(), specifier: null }; });
  const builder = (r, self) => r.object(self).request;
  def(REQUEST_BUILDER, 'addCapability', `(I)${REQUEST_BUILDER}`, (r, _m, [self, c]) => { range(r, c, MAX_CAPABILITY, 'NetworkCapability'); builder(r, self).capabilities.add(c); return self; });
  def(REQUEST_BUILDER, 'removeCapability', `(I)${REQUEST_BUILDER}`, (r, _m, [self, c]) => { range(r, c, MAX_CAPABILITY, 'NetworkCapability'); builder(r, self).capabilities.delete(c); return self; });
  def(REQUEST_BUILDER, 'addTransportType', `(I)${REQUEST_BUILDER}`, (r, _m, [self, t]) => { range(r, t, MAX_TRANSPORT, 'TransportType'); builder(r, self).transports.add(t); return self; });
  def(REQUEST_BUILDER, 'removeTransportType', `(I)${REQUEST_BUILDER}`, (r, _m, [self, t]) => { range(r, t, MAX_TRANSPORT, 'TransportType'); builder(r, self).transports.delete(t); return self; });
  def(REQUEST_BUILDER, 'clearCapabilities', `()${REQUEST_BUILDER}`, (r, _m, [self]) => { builder(r, self).capabilities.clear(); builder(r, self).transports.clear(); return self; });
  def(REQUEST_BUILDER, 'setIncludeOtherUidNetworks', `(Z)${REQUEST_BUILDER}`, (r, _m, [self]) => self);
  def(REQUEST_BUILDER, 'build', `()${REQUEST}`, (r, _m, [self]) => { const request = r.makeObject(REQUEST), source = builder(r, self); r.object(request).request = { capabilities: new Set(source.capabilities), transports: new Set(source.transports) }; return request; });
  const requestOf = (r, request) => (nullish(request) ? null : r.object(request).request ?? { capabilities: new Set(), transports: new Set() });
  def(REQUEST, 'hasCapability', '(I)Z', (r, _m, [self, c]) => (requestOf(r, self).capabilities.has(c) ? 1 : 0));
  def(REQUEST, 'hasTransport', '(I)Z', (r, _m, [self, t]) => (requestOf(r, self).transports.has(t) ? 1 : 0));
  def(REQUEST, 'canBeSatisfiedBy', `(${CAPABILITIES})Z`, (r, _m, [self, caps]) => (!nullish(caps) && satisfies(requestOf(r, self), r.object(caps)) ? 1 : 0));
  def(REQUEST, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => {
    if (nullish(other) || !r.isSubtype(r.typeOf(other), REQUEST)) return 0;
    const a = requestOf(r, self), b = requestOf(r, other);
    return a.capabilities.size === b.capabilities.size && a.transports.size === b.transports.size && [...a.capabilities].every(c => b.capabilities.has(c)) && [...a.transports].every(t => b.transports.has(t)) ? 1 : 0;
  });
  def(REQUEST, 'hashCode', '()I', (r, _m, [self]) => { const q = requestOf(r, self); return [...q.capabilities].reduce((h, c) => (h * 31 + c) | 0, 17) ^ [...q.transports].reduce((h, t) => (h * 31 + t) | 0, 7); });

  // ---- NetworkCapabilities beyond transport and capability queries
  def(CAPABILITIES, 'getNetworkSpecifier', '()Landroid/net/NetworkSpecifier;', () => null); def(CAPABILITIES, 'getTransportInfo', '()Landroid/net/TransportInfo;', () => null);
  def(CAPABILITIES, 'getOwnerUid', '()I', () => -1); def(CAPABILITIES, 'getAdministratorUids', '()[I', r => r.newArray('[I', 0)); def(CAPABILITIES, 'getEnterpriseIds', '()[I', r => r.newArray('[I', 0));
  def(CAPABILITIES, 'getCapabilities', '()[I', (r, _m, [self]) => { const caps = r.object(self), held = [12, 13, 14, 15, 16, 18, 19, 20, 21].concat(caps.metered ? [] : [11]).sort((a, b) => a - b); const array = r.newArray('[I', held.length); r.array(array).elements = held; return array; });
  def(CAPABILITIES, 'getTransportTypes', '()[I', (r, _m, [self]) => { const array = r.newArray('[I', 1); r.array(array).elements = [r.object(self).transport]; return array; });
  def(CAPABILITIES, 'getSsid', `()${STRING}`, () => null);

  // ---- LinkProperties
  const emptyList = r => { const list = r.allocate('Ljava/util/ArrayList;'); call(r, list, 'Ljava/util/ArrayList;', '<init>', [], 'V', [], 'direct'); return list; };
  const interfaceName = (r, self) => r.object(self).interfaceName;
  def(LINK_PROPERTIES, '<init>', '()V', (r, _m, [self]) => { r.object(self).interfaceName = null; });
  def(LINK_PROPERTIES, 'getInterfaceName', `()${STRING}`, (r, _m, [self]) => interfaceName(r, self));
  for (const name of ['getLinkAddresses', 'getAllLinkAddresses', 'getDnsServers', 'getValidatedPrivateDnsServers', 'getPcscfServers', 'getRoutes', 'getAllRoutes', 'getAllInterfaceNames']) def(LINK_PROPERTIES, name, `()${LIST}`, r => emptyList(r));
  for (const name of ['getDomains', 'getPrivateDnsServerName', 'getTcpBufferSizes']) def(LINK_PROPERTIES, name, `()${STRING}`, () => null);
  def(LINK_PROPERTIES, 'getHttpProxy', '()Landroid/net/ProxyInfo;', () => null); def(LINK_PROPERTIES, 'getNat64Prefix', '()Landroid/net/IpPrefix;', () => null);
  def(LINK_PROPERTIES, 'isPrivateDnsActive', '()Z', () => 0); def(LINK_PROPERTIES, 'isWakeOnLanSupported', '()Z', () => 0); def(LINK_PROPERTIES, 'getMtu', '()I', () => 0);
  def(LINK_PROPERTIES, 'toString', `()${STRING}`, (r, _m, [self]) => `{InterfaceName: ${interfaceName(r, self)} LinkAddresses: [] DnsAddresses: [] Domains: null MTU: 0 Routes: [] }`);
  const linkProperties = (r, network) => { const lp = r.makeObject(LINK_PROPERTIES); r.object(lp).interfaceName = r.object(network).transport === 1 ? 'wlan0' : 'rmnet_data0'; return lp; };
  def(CONNECTIVITY, 'getLinkProperties', `(${NETWORK})${LINK_PROPERTIES}`, (r, _m, [, network]) => { const active = activeNetwork(r); return !nullish(network) && active && active.ref === network.ref ? linkProperties(r, network) : null; });

  // ---- NetworkCallback
  def(CALLBACK, '<init>', '()V', (r, _m, [self]) => { r.object(self).flags = 0; });
  def(CALLBACK, '<init>', '(I)V', (r, _m, [self, flags]) => { r.object(self).flags = flags; });   // API 31: FLAG_INCLUDE_LOCATION_INFO = 1
  def(CALLBACK, 'onUnavailable', '()V', () => {});
  for (const name of ['onAvailable', 'onLost', 'onNetworkSuspended', 'onNetworkResumed']) def(CALLBACK, name, `(${NETWORK})V`, () => {});
  def(CALLBACK, 'onCapabilitiesChanged', `(${NETWORK}${CAPABILITIES})V`, () => {}); def(CALLBACK, 'onLinkPropertiesChanged', `(${NETWORK}${LINK_PROPERTIES})V`, () => {});
  def(CALLBACK, 'onLosing', `(${NETWORK}I)V`, () => {}); def(CALLBACK, 'onBlockedStatusChanged', `(${NETWORK}Z)V`, () => {});

  // ---- delivery
  const post = (r, entry, task, force = false) => {
    const run = () => { if (force || entries.includes(entry)) task(); };
    if (nullish(entry.handler)) { platform.queueTask(run, 0, [entry.callback, entry.network]); return; }
    const runnable = r.allocate(DELIVERY); r.object(runnable).task = run;
    call(r, entry.handler, HANDLER, 'post', [RUNNABLE], 'Z', [runnable]);
  };
  const announce = (r, entry, network) => {
    entry.network = network;
    post(r, entry, () => {
      call(r, entry.callback, CALLBACK, 'onAvailable', [NETWORK], 'V', [network]);
      call(r, entry.callback, CALLBACK, 'onCapabilitiesChanged', [NETWORK, CAPABILITIES], 'V', [network, capabilitiesFor(r, network)]);
      call(r, entry.callback, CALLBACK, 'onLinkPropertiesChanged', [NETWORK, LINK_PROPERTIES], 'V', [network, linkProperties(r, network)]);
      call(r, entry.callback, CALLBACK, 'onBlockedStatusChanged', [NETWORK, 'Z'], 'V', [network, 0]);
    });
  };
  const lose = (r, entry) => { const lost = entry.network; entry.network = null; post(r, entry, () => call(r, entry.callback, CALLBACK, 'onLost', [NETWORK], 'V', [lost])); };
  /** The active network changed (or a callback was just registered): bring every entry in line with the network it should be tracking. */
  const reconcile = (r, entry) => {
    const network = activeNetwork(r), matches = network && satisfies(entry.request, r.object(capabilitiesFor(r, network)));
    if (entry.network && (!matches || entry.network.ref !== network.ref)) lose(r, entry);
    if (matches && !entry.network) announce(r, entry, network);
  };
  const add = (r, callback, request, handler, kind, timeoutMs = 0) => {
    if (nullish(callback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'null NetworkCallback');
    const entry = { callback, request, handler: nullish(handler) ? null : handler, kind, network: null, timeoutMs }; entries.push(entry);
    reconcile(r, entry);
    if (kind === 'request' && timeoutMs > 0) platform.queueTask(() => {
      if (!entries.includes(entry) || entry.network) return;
      entries.splice(entries.indexOf(entry), 1);
      post(r, entry, () => call(r, entry.callback, CALLBACK, 'onUnavailable', [], 'V', []), true);   // requestNetwork timed out: the registration is released, onUnavailable is its last call
    }, timeoutMs, [callback]);
  };
  const reqOf = (r, request) => { if (nullish(request)) r.throwJava('Ljava/lang/NullPointerException;', null); return requestOf(r, request); };
  def(CONNECTIVITY, 'registerDefaultNetworkCallback', `(${CALLBACK})V`, (r, _m, [, callback]) => add(r, callback, null, null, 'default'));
  def(CONNECTIVITY, 'registerDefaultNetworkCallback', `(${CALLBACK}${HANDLER})V`, (r, _m, [, callback, handler]) => add(r, callback, null, handler, 'default'));
  def(CONNECTIVITY, 'registerNetworkCallback', `(${REQUEST}${CALLBACK})V`, (r, _m, [, request, callback]) => add(r, callback, reqOf(r, request), null, 'match'));
  def(CONNECTIVITY, 'registerNetworkCallback', `(${REQUEST}${CALLBACK}${HANDLER})V`, (r, _m, [, request, callback, handler]) => add(r, callback, reqOf(r, request), handler, 'match'));
  def(CONNECTIVITY, 'registerBestMatchingNetworkCallback', `(${REQUEST}${CALLBACK}${HANDLER})V`, (r, _m, [, request, callback, handler]) => add(r, callback, reqOf(r, request), handler, 'match'));
  const timeout = (r, ms) => { if (ms <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'timeoutMs must be strictly positive.'); return ms; };
  def(CONNECTIVITY, 'requestNetwork', `(${REQUEST}${CALLBACK})V`, (r, _m, [, request, callback]) => add(r, callback, reqOf(r, request), null, 'request'));
  def(CONNECTIVITY, 'requestNetwork', `(${REQUEST}${CALLBACK}${HANDLER})V`, (r, _m, [, request, callback, handler]) => add(r, callback, reqOf(r, request), handler, 'request'));
  def(CONNECTIVITY, 'requestNetwork', `(${REQUEST}${CALLBACK}I)V`, (r, _m, [, request, callback, ms]) => add(r, callback, reqOf(r, request), null, 'request', timeout(r, ms)));
  def(CONNECTIVITY, 'requestNetwork', `(${REQUEST}${CALLBACK}I${HANDLER})V`, (r, _m, [, request, callback, ms, handler]) => add(r, callback, reqOf(r, request), handler, 'request', timeout(r, ms)));
  def(CONNECTIVITY, 'unregisterNetworkCallback', `(${CALLBACK})V`, (r, _m, [, callback]) => {
    if (nullish(callback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid NetworkCallback');
    const at = entries.findIndex(entry => entry.callback.ref === callback.ref);
    if (at < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'NetworkCallback was not registered');
    entries.splice(at, 1);
  });
  // the rest of the client surface that needs no network stack
  const bound = platform.boundNetwork ??= { network: null };
  def(CONNECTIVITY, 'getBoundNetworkForProcess', `()${NETWORK}`, () => bound.network);
  def(CONNECTIVITY, 'bindProcessToNetwork', `(${NETWORK})Z`, (r, _m, [, network]) => { bound.network = nullish(network) ? null : network; return 1; });
  def(CONNECTIVITY, 'reportNetworkConnectivity', `(${NETWORK}Z)V`, () => {});
  def(CONNECTIVITY, 'getDefaultProxy', '()Landroid/net/ProxyInfo;', () => null);
  def(CONNECTIVITY, 'isDefaultNetworkActive', '()Z', r => (activeNetwork(r) ? 1 : 0));
  def(CONNECTIVITY, 'getRestrictBackgroundStatus', '()I', () => 1);   // RESTRICT_BACKGROUND_STATUS_DISABLED

  return { connectivityChanged(r) { for (const entry of [...entries]) reconcile(r, entry); } };
}
