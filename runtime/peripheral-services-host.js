import { bitsFloat, floatBits } from './host-contract.js?v=803d82a8b127';
import { APKError } from './apk-error.js?v=803d82a8b127';
import { installSoundPool } from './sound-pool-host.js?v=803d82a8b127';
import { createServiceKit, OBJECT, STRING, LIST, DEVICE_FEATURES } from './service-kit.js?v=803d82a8b127';
import { installCameraManager } from './camera-host.js?v=803d82a8b127';

// System services of the hardware a phone has (or lacks), answered the way an API 33 phone answers when that hardware or account is absent (android-13.0.0_r1 sources of each
// manager, SystemServiceRegistry and the service implementations). The virtual device advertises only DEVICE_FEATURES (src/service-kit.js): Wi-Fi, no Bluetooth, NFC, camera, USB
// host, IR, MIDI, Wi-Fi Direct. Where the framework returns null for a missing service, so does getSystemService (WifiP2pManager, MidiManager).
export function createPeripheralServicesHost(platform) {
  const kit = createServiceKit(platform), { def, type, service, call, text, enforce, hasFeature, construct, emptyList, listOf, stringArray, intArray, device, npe, iae, ise, nullish, registry } = kit;
  const connectivity = () => device().connectivity ?? 'online';
  const principal = r => platform.virtualProcess?.uid ?? 10000;

  // ---- VibratorManager (API 31): a device without vibrator motors has no vibrator ids
  const VIBRATOR_MANAGER = service('vibrator_manager', 'Landroid/os/VibratorManager;'), VIBRATOR = 'Landroid/os/Vibrator;', COMBINED = 'Landroid/os/CombinedVibration;';
  def(VIBRATOR_MANAGER, 'getVibratorIds', '()[I', r => intArray(r, []));
  def(VIBRATOR_MANAGER, 'getVibrator', `(I)${VIBRATOR}`, (r, _m, [, id]) => platform.hardwareServices.getService(r, 'vibrator'));   // an unknown id is the NoOpVibrator; the lab vibrator is the no-op one
  def(VIBRATOR_MANAGER, 'getDefaultVibrator', `()${VIBRATOR}`, r => platform.hardwareServices.getService(r, 'vibrator'));
  def(VIBRATOR_MANAGER, 'vibrate', `(${COMBINED})V`, (r, _m, [, effect]) => { if (nullish(effect)) npe(r); });
  def(VIBRATOR_MANAGER, 'vibrate', `(${COMBINED}Landroid/os/VibrationAttributes;)V`, (r, _m, [, effect]) => { if (nullish(effect)) npe(r); });
  def(VIBRATOR_MANAGER, 'cancel', '()V', () => {});

  // ---- WifiManager: one Wi-Fi radio that is on and associated exactly while the device profile says "online" (the same condition ConnectivityManager uses for its Wi-Fi network)
  const WIFI = service('wifi', 'Landroid/net/wifi/WifiManager;'), WIFI_INFO = 'Landroid/net/wifi/WifiInfo;', DHCP = 'Landroid/net/DhcpInfo;', WIFI_LOCK = 'Landroid/net/wifi/WifiManager$WifiLock;', MULTICAST_LOCK = 'Landroid/net/wifi/WifiManager$MulticastLock;';
  type(WIFI_INFO, OBJECT, [], { allocatable: false }); type(DHCP, OBJECT, [], { allocatable: true }); type(WIFI_LOCK, OBJECT, [], { allocatable: false }); type(MULTICAST_LOCK, OBJECT, [], { allocatable: false });
  const connected = () => connectivity() === 'online';
  const WIFI_STATE_DISABLED = 1, WIFI_STATE_ENABLED = 3, INVALID_RSSI = -127, UNKNOWN_SSID = '<unknown ssid>', DEFAULT_MAC = '02:00:00:00:00:00';
  const EMULATED_SSID = '"AndroidWifi"', EMULATED_BSSID = '00:13:10:85:fe:01', EMULATED_IP = 0x0F02000A, GATEWAY = 0x0202000A, NETMASK = 0x00FFFFFF, DNS = 0x0302000A;   // 10.0.2.15/24, gateway 10.0.2.2, dns 10.0.2.3
  def(WIFI, 'isWifiEnabled', '()Z', () => connected() ? 1 : 0);
  def(WIFI, 'getWifiState', '()I', () => connected() ? WIFI_STATE_ENABLED : WIFI_STATE_DISABLED);
  def(WIFI, 'setWifiEnabled', '(Z)Z', r => { enforce(r, 'android.permission.CHANGE_WIFI_STATE'); return 0; });   // targetSdk >= 29: apps can no longer toggle Wi-Fi; the call returns false
  def(WIFI, 'isScanAlwaysAvailable', '()Z', () => 0);
  def(WIFI, 'is5GHzBandSupported', '()Z', () => 0); def(WIFI, 'is6GHzBandSupported', '()Z', () => 0); def(WIFI, 'is24GHzBandSupported', '()Z', () => 1);
  def(WIFI, 'isP2pSupported', '()Z', () => 0); def(WIFI, 'isTdlsSupported', '()Z', () => 0); def(WIFI, 'isPreferredNetworkOffloadSupported', '()Z', () => 0);
  def(WIFI, 'isEnhancedOpenSupported', '()Z', () => 0); def(WIFI, 'isWpa3SaeSupported', '()Z', () => 0); def(WIFI, 'isWifiStandardSupported', '(I)Z', () => 0);
  // Capability queries that WifiManager.java (android-13) answers from the supported-feature mask: this virtual radio is a 2.4 GHz client without the optional features, so each is false
  // (isWpa3SaePublicKeySupported is literally false in the framework). is60GHzBandSupported asks the service, which has no 60 GHz radio.
  for (const name of ['isDeviceToApRttSupported', 'isEnhancedPowerReportingSupported', 'isEasyConnectSupported', 'isEasyConnectEnrolleeResponderModeSupported', 'isEasyConnectDppAkmSupported', 'isWapiSupported', 'isWpa3SuiteBSupported',
    'isStaApConcurrencySupported', 'isBridgedApConcurrencySupported', 'isStaBridgedApConcurrencySupported', 'isMakeBeforeBreakWifiSwitchingSupported', 'isWpa3SaeH2eSupported', 'isWpa3SaePublicKeySupported', 'isDecoratedIdentitySupported',
    'isTrustOnFirstUseSupported', 'isPasspointTermsAndConditionsSupported', 'isWifiDisplayR2Supported', 'isStaConcurrencyForLocalOnlyConnectionsSupported', 'isStaConcurrencyForMultiInternetSupported', 'is60GHzBandSupported']) def(WIFI, name, '()Z', () => 0);
  def(WIFI, 'pingSupplicant', '()Z', () => (connected() ? 1 : 0));   // return isWifiEnabled()
  def(WIFI, 'getMaxNumberOfNetworkSuggestionsPerApp', '()I', () => 1024);   // isLowRamDevice() is false: NETWORK_SUGGESTIONS_MAX_PER_APP_HIGH_RAM
  def(WIFI, 'updateNetwork', '(Landroid/net/wifi/WifiConfiguration;)I', () => -1);   // null or negative networkId is -1 in the client; this app has no saved network to update
  def(WIFI, 'getMaxSignalLevel', '()I', () => 4);
  def(WIFI, 'calculateSignalLevel', '(II)I', (r, _m, [rssi, levels]) => { if (levels <= 1) iae(r, 'numLevels ' + levels + ' must be at least 2'); return rssi <= -100 ? 0 : rssi >= -55 ? levels - 1 : Math.trunc((rssi + 100) * (levels - 1) / 45); }, { static: true });
  def(WIFI, 'compareSignalLevel', '(II)I', (r, _m, [a, b]) => a - b, { static: true });
  def(WIFI, 'getConnectionInfo', `()${WIFI_INFO}`, r => { enforce(r, 'android.permission.ACCESS_WIFI_STATE'); const info = r.makeObject(WIFI_INFO); r.object(info).wifiInfo = { connected: connected(), location: kit.holds(r, 'android.permission.ACCESS_FINE_LOCATION') }; return info; });
  const info = (r, ref) => r.object(ref).wifiInfo ?? npe(r, 'WifiInfo used before it was obtained');
  // android.net.wifi.SupplicantState: the wpa_supplicant states; the virtual radio is COMPLETED while associated (connectivity online) and DISCONNECTED otherwise.
  const SUPPLICANT = 'Landroid/net/wifi/SupplicantState;', SUPPLICANT_NAMES = ['DISCONNECTED', 'INTERFACE_DISABLED', 'INACTIVE', 'SCANNING', 'AUTHENTICATING', 'ASSOCIATING', 'ASSOCIATED', 'FOUR_WAY_HANDSHAKE', 'GROUP_HANDSHAKE', 'COMPLETED', 'DORMANT', 'UNINITIALIZED', 'INVALID'];
  type(SUPPLICANT, 'Ljava/lang/Enum;', ['Landroid/os/Parcelable;'], { allocatable: true });
  const supplicant = (r, ordinal) => r.readStatic({ owner: SUPPLICANT, name: SUPPLICANT_NAMES[ordinal], type: SUPPLICANT, key: `${SUPPLICANT}->${SUPPLICANT_NAMES[ordinal]}:${SUPPLICANT}` });
  SUPPLICANT_NAMES.forEach((name, ordinal) => registry.staticField(SUPPLICANT, name, SUPPLICANT, r => { const value = r.allocate(SUPPLICANT), o = r.object(value); o.enumName = name; o.enumOrdinal = ordinal; return value; }));
  def(SUPPLICANT, 'values', `()[${SUPPLICANT}`, r => { const array = r.newArray(`[${SUPPLICANT}`, SUPPLICANT_NAMES.length); r.array(array).elements = SUPPLICANT_NAMES.map((_, i) => supplicant(r, i)); return array; }, { static: true });
  def(SUPPLICANT, 'valueOf', `(${STRING})${SUPPLICANT}`, (r, _m, [name]) => { if (nullish(name)) npe(r, 'Name is null'); const at = SUPPLICANT_NAMES.indexOf(text(r, name)); if (at < 0) iae(r, `No enum constant android.net.wifi.SupplicantState.${text(r, name)}`); return supplicant(r, at); }, { static: true });
  def(SUPPLICANT, 'isValidState', `(${SUPPLICANT})Z`, (r, _m, [state]) => { if (nullish(state)) npe(r); const o = r.object(state).enumOrdinal; return o !== 11 && o !== 12 ? 1 : 0; }, { static: true });   // UNINITIALIZED and INVALID are not states wpa_supplicant reports
  def(SUPPLICANT, 'describeContents', '()I', () => 0);
  def(WIFI_INFO, 'getSupplicantState', `()${SUPPLICANT}`, (r, _m, [self]) => supplicant(r, info(r, self).connected ? 9 : 0));
  def(WIFI_INFO, 'getCurrentSecurityType', '()I', (r, _m, [self]) => info(r, self).connected ? 0 : -1);   // SECURITY_TYPE_OPEN for the emulated open access point / SECURITY_TYPE_UNKNOWN
  def(WIFI_INFO, 'isRestricted', '()Z', () => 0);
  def(WIFI_INFO, 'getSubscriptionId', '()I', () => -1);   // not a carrier Wi-Fi network: SubscriptionManager.INVALID_SUBSCRIPTION_ID
  def(WIFI_INFO, 'getPasspointFqdn', `()${STRING}`, () => null); def(WIFI_INFO, 'getPasspointProviderFriendlyName', `()${STRING}`, () => null);
  def(WIFI_INFO, 'getInformationElements', `()${LIST}`, r => emptyList(r));
  def(WIFI_INFO, 'getMaxSupportedTxLinkSpeedMbps', '()I', (r, _m, [self]) => info(r, self).connected ? 144 : -1); def(WIFI_INFO, 'getMaxSupportedRxLinkSpeedMbps', '()I', (r, _m, [self]) => info(r, self).connected ? 144 : -1);
  def(WIFI_INFO, 'getApplicableRedactions', '()J', () => 7n);   // REDACT_FOR_ACCESS_FINE_LOCATION | REDACT_FOR_LOCAL_MAC_ADDRESS | REDACT_FOR_NETWORK_SETTINGS
  def(WIFI_INFO, 'makeCopy', `(J)${WIFI_INFO}`, (r, _m, [self]) => { const copy = r.makeObject(WIFI_INFO); r.object(copy).wifiInfo = { ...info(r, self) }; return copy; });
  def(WIFI_INFO, 'getAffiliatedMloLinks', `()${LIST}`, r => emptyList(r)); def(WIFI_INFO, 'getApMldMacAddress', '()Landroid/net/MacAddress;', () => null); def(WIFI_INFO, 'getApMloLinkId', '()I', () => -1);
  def(WIFI_INFO, 'describeContents', '()I', () => 0);
  def(WIFI_INFO, 'writeToParcel', '(Landroid/os/Parcel;I)V', () => { throw new APKError('WifiInfo.writeToParcel: the virtual device has no WifiInfo CREATOR to read it back with', { kind: 'wifi-info-parcel-unsupported' }); });
  def(WIFI_INFO, 'getSSID', `()${STRING}`, (r, _m, [self]) => { const i = info(r, self); return i.connected && i.location ? EMULATED_SSID : UNKNOWN_SSID; });   // the SSID is redacted without location access
  def(WIFI_INFO, 'getBSSID', `()${STRING}`, (r, _m, [self]) => { const i = info(r, self); return i.connected && i.location ? EMULATED_BSSID : DEFAULT_MAC; });
  def(WIFI_INFO, 'getMacAddress', `()${STRING}`, () => DEFAULT_MAC);   // apps always see the placeholder address since Android 6
  def(WIFI_INFO, 'getRssi', '()I', (r, _m, [self]) => info(r, self).connected ? -50 : INVALID_RSSI);
  def(WIFI_INFO, 'getLinkSpeed', '()I', (r, _m, [self]) => info(r, self).connected ? 144 : -1);
  def(WIFI_INFO, 'getTxLinkSpeedMbps', '()I', (r, _m, [self]) => info(r, self).connected ? 144 : -1); def(WIFI_INFO, 'getRxLinkSpeedMbps', '()I', (r, _m, [self]) => info(r, self).connected ? 144 : -1);
  def(WIFI_INFO, 'getFrequency', '()I', (r, _m, [self]) => info(r, self).connected ? 2437 : -1);
  def(WIFI_INFO, 'getNetworkId', '()I', (r, _m, [self]) => info(r, self).connected ? 0 : -1);
  def(WIFI_INFO, 'getIpAddress', '()I', (r, _m, [self]) => info(r, self).connected ? EMULATED_IP : 0);
  def(WIFI_INFO, 'getHiddenSSID', '()Z', () => 0);
  def(WIFI_INFO, 'getWifiStandard', '()I', (r, _m, [self]) => info(r, self).connected ? 4 : 0);   // WIFI_STANDARD_11N / unknown
  def(WIFI_INFO, 'toString', `()${STRING}`, (r, _m, [self]) => { const i = info(r, self); return `SSID: ${i.connected && i.location ? EMULATED_SSID : UNKNOWN_SSID}, BSSID: ${i.connected && i.location ? EMULATED_BSSID : DEFAULT_MAC}, MAC: ${DEFAULT_MAC}, Supplicant state: ${i.connected ? 'COMPLETED' : 'DISCONNECTED'}, Wi-Fi standard: ${i.connected ? 4 : 0}`; });
  for (const name of ['ipAddress', 'gateway', 'netmask', 'dns1', 'dns2', 'serverAddress', 'leaseDuration']) registry.instanceField(DHCP, name, 'I', { reflect: true });
  def(DHCP, '<init>', '()V', () => {});
  def(WIFI, 'getDhcpInfo', `()${DHCP}`, r => {
    enforce(r, 'android.permission.ACCESS_WIFI_STATE'); const dhcp = r.allocate(DHCP), up = connected();
    for (const [name, value] of Object.entries({ ipAddress: EMULATED_IP, gateway: GATEWAY, netmask: NETMASK, dns1: DNS, dns2: 0, serverAddress: GATEWAY, leaseDuration: 86400 })) r.storeField(r.object(dhcp).fields, `${DHCP}->${name}:I`, up ? value : 0);
    return dhcp;
  });
  def(WIFI, 'getScanResults', `()${LIST}`, r => { enforce(r, 'android.permission.ACCESS_WIFI_STATE'); if (!kit.holds(r, 'android.permission.ACCESS_FINE_LOCATION') && !kit.holds(r, 'android.permission.ACCESS_COARSE_LOCATION')) r.throwJava('Ljava/lang/SecurityException;', `uid:${principal(r)} does not have ACCESS_FINE_LOCATION permission.`); return emptyList(r); });   // no access point is in range
  def(WIFI, 'startScan', '()Z', r => { enforce(r, 'android.permission.CHANGE_WIFI_STATE'); return 0; });   // scans are throttled to nothing for apps: the request is refused
  def(WIFI, 'getConfiguredNetworks', `()${LIST}`, r => { enforce(r, 'android.permission.ACCESS_WIFI_STATE'); return emptyList(r); });   // empty for non-privileged apps since Android 10
  def(WIFI, 'addNetwork', '(Landroid/net/wifi/WifiConfiguration;)I', () => -1);
  for (const name of ['disconnect', 'reconnect', 'reassociate', 'saveConfiguration']) def(WIFI, name, '()Z', () => 0);
  for (const name of ['removeNetwork', 'enableNetwork', 'disableNetwork']) def(WIFI, name, name === 'enableNetwork' ? '(IZ)Z' : '(I)Z', () => 0);
  // Locks: counted holds that only keep a (nonexistent) radio awake; semantics of WifiManager.WifiLock / MulticastLock
  const lock = (owner, makeSignature) => {
    def(owner, 'acquire', '()V', (r, _m, [self]) => { const s = r.object(self).lockState; if (!s.counted && s.held) return; if (s.counted) s.count++; s.held = true; });
    def(owner, 'release', '()V', (r, _m, [self]) => {
      const s = r.object(self).lockState;
      if (s.counted) { if (--s.count < 0) r.throwJava('Ljava/lang/RuntimeException;', `${s.kind} under-locked ${s.tag}`); s.held = s.count > 0; }
      else { if (!s.held) return; s.held = false; }
    });
    def(owner, 'isHeld', '()Z', (r, _m, [self]) => r.object(self).lockState.held ? 1 : 0);
    def(owner, 'setReferenceCounted', '(Z)V', (r, _m, [self, counted]) => { r.object(self).lockState.counted = counted === 1 || counted === true; });
    def(owner, 'toString', `()${STRING}`, (r, _m, [self]) => { const s = r.object(self).lockState; return `${s.kind} ${s.tag} held=${s.held}; refcounted=${s.counted}`; });
  };
  lock(WIFI_LOCK); lock(MULTICAST_LOCK);
  const newLock = (r, owner, kind, tag) => { const o = r.makeObject(owner); r.object(o).lockState = { kind, tag: (tag === null || tag === 0) ? null : text(r, tag), held: false, counted: true, count: 0 }; return o; };
  def(WIFI, 'createWifiLock', `(${STRING})${WIFI_LOCK}`, (r, _m, [, tag]) => newLock(r, WIFI_LOCK, 'WifiLock', tag));
  def(WIFI, 'createWifiLock', `(I${STRING})${WIFI_LOCK}`, (r, _m, [, mode, tag]) => { if (![1, 2, 3, 4].includes(mode)) iae(r, `Illegal argument, lockType ${mode}`); return newLock(r, WIFI_LOCK, 'WifiLock', tag); });
  def(WIFI, 'createMulticastLock', `(${STRING})${MULTICAST_LOCK}`, (r, _m, [, tag]) => newLock(r, MULTICAST_LOCK, 'MulticastLock', tag));

  // ---- BluetoothManager / NfcManager: the services exist, the adapters do not (SystemServer starts Bluetooth/NFC only with the feature)
  const BLUETOOTH = service('bluetooth', 'Landroid/bluetooth/BluetoothManager;');
  // NfcManager is the original framework class: its constructor asks NfcAdapter.getNfcAdapter, which on a device without FEATURE_NFC logs "this device does not have NFC support" and throws
  // UnsupportedOperationException, so getDefaultAdapter() is null (NfcAdapter.getDefaultAdapter(Context) answers null earlier still: there is no "nfc" service). No adapter object ever exists.
  kit.classService('nfc', 'Landroid/nfc/NfcManager;', r => construct(r, 'Landroid/nfc/NfcManager;', ['Landroid/content/Context;'], [platform.application]));
  // The hidden process accessors the NFC originals read: ServiceManager.getService (the Java registry, src/java-services-host.js: no "nfc" binder) and the IPackageManager feature query.
  const IPM = 'Landroid/content/pm/IPackageManager;', PM_BINDER = 'Ldev/apkweb/pm/PackageManagerBinder;';
  type(PM_BINDER, OBJECT, [IPM], { allocatable: true });
  def('Landroid/app/ActivityThread;', 'getPackageManager', `()${IPM}`, r => { platform.packageManagerBinder ??= r.allocate(PM_BINDER); return platform.packageManagerBinder; }, { static: true });
  for (const owner of [IPM, PM_BINDER]) def(owner, 'hasSystemFeature', `(${STRING}I)Z`, (r, _m, [, name]) => { if (nullish(name)) npe(r); return hasFeature(text(r, name)) ? 1 : 0; });
  for (const name of ['isResumed', 'registerOnActivityPausedListener', 'unregisterOnActivityPausedListener']) def('Ldev/apkweb/os/NfcHost;', name, name === 'isResumed' ? '(Landroid/app/Activity;)Z' : '(Landroid/app/Activity;Landroid/app/OnActivityPausedListener;)V', () => { throw new APKError(`NfcAdapter foreground dispatch (${name}) needs an NFC adapter, which this virtual device does not have`, { kind: 'nfc-unavailable' }); }, { static: true });
  // android.nfc.cardemulation.CardEmulation / NfcFCardEmulation.getInstance(NfcAdapter) (android-13.0.0_r1): the first statement of both is
  // `if (adapter == null) throw new NullPointerException("NfcAdapter is null")`. With no NFC hardware no NfcAdapter object can exist (see above), so that is the only path an app
  // reaches; the rest of the original (the FEATURE_NFC_HOST_CARD_EMULATION check, the INfcCardEmulation service) and every instance method need an adapter, and an adapter that
  // somehow got here takes the original's next branch on this device: no card emulation feature, UnsupportedOperationException.
  for (const owner of ['Landroid/nfc/cardemulation/CardEmulation;', 'Landroid/nfc/cardemulation/NfcFCardEmulation;']) {
    type(owner, OBJECT, [], { allocatable: false });
    def(owner, 'getInstance', `(Landroid/nfc/NfcAdapter;)${owner}`, (r, _m, [adapter]) => {
      if (nullish(adapter)) r.throwJava('Ljava/lang/NullPointerException;', 'NfcAdapter is null');
      r.throwJava('Ljava/lang/UnsupportedOperationException;', null);
    }, { static: true });
  }
  def(BLUETOOTH, 'getAdapter', '()Landroid/bluetooth/BluetoothAdapter;', () => null);
  const gattProfile = (r, profile) => { if (profile !== 7 && profile !== 8) iae(r, `Profile not supported: ${profile}`); };   // BluetoothProfile.GATT / GATT_SERVER
  def(BLUETOOTH, 'getConnectedDevices', `(I)${LIST}`, (r, _m, [, profile]) => { gattProfile(r, profile); return emptyList(r); });
  def(BLUETOOTH, 'getDevicesMatchingConnectionStates', `(I[I)${LIST}`, (r, _m, [, profile]) => { gattProfile(r, profile); return emptyList(r); });
  def(BLUETOOTH, 'getConnectionState', '(Landroid/bluetooth/BluetoothDevice;I)I', (r, _m, [, , profile]) => { gattProfile(r, profile); return 0; });

  // ---- CameraManager: the cameras of the page's camera source, none until a page attaches (src/camera-host.js)
  installCameraManager(kit, platform, service('camera', 'Landroid/hardware/camera2/CameraManager;'));

  // ---- UsbManager: no host or accessory port, so no devices
  const USB = service('usb', 'Landroid/hardware/usb/UsbManager;');
  def(USB, 'getDeviceList', '()Ljava/util/HashMap;', r => construct(r, 'Ljava/util/HashMap;'));
  def(USB, 'getAccessoryList', '()[Landroid/hardware/usb/UsbAccessory;', () => null);
  def(USB, 'hasPermission', '(Landroid/hardware/usb/UsbDevice;)Z', (r, _m, [, usbDevice]) => { if (nullish(usbDevice)) return 0; return 0; });

  // ---- WifiScanner (@SystemApi, Context.WIFI_SCANNING_SERVICE "wifiscanner"): registered on every device with Wi-Fi (WifiFrameworkInitializer), so getSystemService hands it out; every
  // scan call of IWifiScanner needs LOCATION_HARDWARE / NETWORK_STACK, which an installed app does not hold, so no method is offered here (a call names itself as unsupported).
  service('wifiscanner', 'Landroid/net/wifi/WifiScanner;');
  // ---- ConsumerIrManager: no IR emitter
  const IR = service('consumer_ir', 'Landroid/hardware/ConsumerIrManager;');
  def(IR, 'hasIrEmitter', '()Z', () => 0);
  def(IR, 'transmit', '(I[I)V', () => {});
  def(IR, 'getCarrierFrequencies', '()[Landroid/hardware/ConsumerIrManager$CarrierFrequencyRange;', () => null);

  // ---- Wi-Fi Direct and MIDI: the services are not started without their features, getSystemService returns null for both (registered as absent)
  const NULL_SERVICES = ['wifip2p', 'midi'];
  type('Landroid/net/wifi/p2p/WifiP2pManager;', OBJECT, [], { allocatable: false }); type('Landroid/media/midi/MidiManager;', OBJECT, [], { allocatable: false });
  kit.byClass.set('Landroid/net/wifi/p2p/WifiP2pManager;', 'wifip2p'); kit.byClass.set('Landroid/media/midi/MidiManager;', 'midi');

  // ---- InputManager: only the (virtual) touchscreen is not an InputDevice; no input device is enumerated
  const INPUT = service('input', 'Landroid/hardware/input/InputManager;');
  def(INPUT, 'getInputDeviceIds', '()[I', r => intArray(r, []));
  def(INPUT, 'getInputDevice', '(I)Landroid/view/InputDevice;', () => null);
  def(INPUT, 'registerInputDeviceListener', '(Landroid/hardware/input/InputManager$InputDeviceListener;Landroid/os/Handler;)V', (r, _m, [, listener]) => { if (nullish(listener)) iae(r, 'listener must not be null'); });
  def(INPUT, 'unregisterInputDeviceListener', '(Landroid/hardware/input/InputManager$InputDeviceListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) iae(r, 'listener must not be null'); });
  def(INPUT, 'getPointerSpeed', '(Landroid/content/Context;)I', () => 0, { static: true }); def(INPUT, 'isStylusPointerIconEnabled', '()Z', () => 0);
  def(INPUT, 'getMaximumObscuringOpacityForTouch', '()F', () => floatBits(0.8));

  // ---- DisplayManager: the single built-in display
  const DISPLAY_MANAGER = service('display', 'Landroid/hardware/display/DisplayManager;'), DISPLAY = 'Landroid/view/Display;';
  def(DISPLAY_MANAGER, 'getDisplay', `(I)${DISPLAY}`, (r, _m, [, id]) => (id === 0 ? platform.displayHost.get(r) : null));
  def(DISPLAY_MANAGER, 'getDisplays', `()[${DISPLAY}`, r => { const a = r.newArray(`[${DISPLAY}`, 1); r.array(a).elements = [platform.displayHost.get(r)]; return a; });
  def(DISPLAY_MANAGER, 'getDisplays', `(${STRING})[${DISPLAY}`, (r, _m, [, category]) => { const a = r.newArray(`[${DISPLAY}`, category === null ? 1 : 0); if (category === null) r.array(a).elements = [platform.displayHost.get(r)]; return a; });   // no presentation displays
  def(DISPLAY_MANAGER, 'registerDisplayListener', '(Landroid/hardware/display/DisplayManager$DisplayListener;Landroid/os/Handler;)V', (r, _m, [, listener]) => { if (nullish(listener)) iae(r, 'listener must not be null'); });
  def(DISPLAY_MANAGER, 'unregisterDisplayListener', '(Landroid/hardware/display/DisplayManager$DisplayListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) iae(r, 'listener must not be null'); });
  // getStableDisplaySize() (hidden; DisplayManagerService.getStableDisplaySize): the default display's size in its natural orientation (no config_stableDeviceDisplay* overlay on this device)
  def(DISPLAY_MANAGER, 'getStableDisplaySize', '()Landroid/graphics/Point;', r => {
    const display = platform.displayHost.get(r), point = r.allocate('Landroid/graphics/Point;');
    r.dispatch({ owner: 'Landroid/graphics/Point;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [point], 'direct');
    r.dispatch({ owner: DISPLAY, name: 'getRealSize', parameters: ['Landroid/graphics/Point;'], result: 'V', signature: '(Landroid/graphics/Point;)V' }, [display, point], 'virtual');
    const rotation = r.dispatch({ owner: DISPLAY, name: 'getRotation', parameters: [], result: 'I', signature: '()I' }, [display], 'virtual');
    if (rotation === 1 || rotation === 3) { const fields = r.object(point).fields, x = 'Landroid/graphics/Point;->x:I', y = 'Landroid/graphics/Point;->y:I', w = fields.get(x), h = fields.get(y); r.storeField(fields, x, h); r.storeField(fields, y, w); }
    return point;
  });
  def(DISPLAY_MANAGER, 'isNightModeActive', '()Z', () => (device().darkTheme ? 1 : 0));

  // ---- HardwarePropertiesManager: thermal data is for device owners and DEVICE_POWER holders only
  const HARDWARE = service('hardware_properties', 'Landroid/os/HardwarePropertiesManager;');
  const hardwareDenied = r => r.throwJava('Ljava/lang/SecurityException;', 'The caller has neither a device owner nor DEVICE_POWER permission.');
  def(HARDWARE, 'getDeviceTemperatures', '(II)[F', r => hardwareDenied(r)); def(HARDWARE, 'getCpuUsages', '()[Landroid/os/CpuUsageInfo;', r => hardwareDenied(r)); def(HARDWARE, 'getFanSpeeds', '()[F', r => hardwareDenied(r));

  // ---- CompanionDeviceManager: without FEATURE_COMPANION_DEVICE_SETUP every query answers "none"
  const COMPANION = service('companiondevice', 'Landroid/companion/CompanionDeviceManager;');
  def(COMPANION, 'getAssociations', `()${LIST}`, r => emptyList(r));
  def(COMPANION, 'getMyAssociations', `()${LIST}`, r => emptyList(r));
  def(COMPANION, 'hasNotificationAccess', '(Landroid/content/ComponentName;)Z', () => 0);
  def(COMPANION, 'isDeviceAssociatedForWifiConnection', `(${STRING}Landroid/net/MacAddress;Landroid/os/UserHandle;)Z`, () => 0);

  // ---- NsdManager: network service discovery has no mDNS responder in the browser; registrations are refused through the listener like a failing daemon would
  const NSD = service('servicediscovery', 'Landroid/net/nsd/NsdManager;');
  def(NSD, 'discoverServices', `(${STRING}ILandroid/net/nsd/NsdManager$DiscoveryListener;)V`, (r, _m, [, type, protocol, listener]) => {
    if (nullish(listener)) iae(r, 'listener cannot be null'); if (nullish(type)) iae(r, 'Service type cannot be empty');
    if (protocol !== 1) iae(r, 'Unsupported protocol');   // NsdManager.PROTOCOL_DNS_SD
    r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Service discovery needs multicast DNS, which the browser VM does not have');
  });
  def(NSD, 'stopServiceDiscovery', '(Landroid/net/nsd/NsdManager$DiscoveryListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) iae(r, 'listener cannot be null'); iae(r, 'listener not registered'); });

  // ---- MediaRouter (android.media.MediaRouter, Context.MEDIA_ROUTER_SERVICE): a phone with no cast, Bluetooth or wired output: the system category ("System") holds the one
  // default route ("Phone", ROUTE_TYPE_LIVE_AUDIO | ROUTE_TYPE_LIVE_VIDEO, local playback on STREAM_MUSIC), which is selected for every type it supports. Callbacks are kept; no
  // route ever appears or changes, so none is called. Volume reads the music stream of AudioManager.
  const ROUTER = service('media_router', 'Landroid/media/MediaRouter;'), ROUTE = 'Landroid/media/MediaRouter$RouteInfo;', CATEGORY = 'Landroid/media/MediaRouter$RouteCategory;', ROUTER_CALLBACK = 'Landroid/media/MediaRouter$Callback;', CHARSEQ = 'Ljava/lang/CharSequence;', CONTEXT = 'Landroid/content/Context;';
  const LIVE_AUDIO = 1, LIVE_VIDEO = 2, SYSTEM_TYPES = LIVE_AUDIO | LIVE_VIDEO;
  type(ROUTE, OBJECT); type(CATEGORY, OBJECT); type(ROUTER_CALLBACK, OBJECT, [], { allocatable: true }); def(ROUTER_CALLBACK, '<init>', '()V', () => {});
  type('Landroid/media/MediaRouter$VolumeCallback;', OBJECT, [], { allocatable: true }); def('Landroid/media/MediaRouter$VolumeCallback;', '<init>', '()V', () => {});   // abstract callback base: the app's subclass
  type('Landroid/media/MediaRouter$SimpleCallback;', ROUTER_CALLBACK, [], { allocatable: true }); def('Landroid/media/MediaRouter$SimpleCallback;', '<init>', '()V', () => {});   // its callbacks are empty
  const routerState = r => (r.mediaRouter ??= (() => { const category = r.makeObject(CATEGORY), route = r.makeObject(ROUTE); r.object(route).mediaRoute = { category }; return { category, route, callbacks: [] }; })());
  const music = r => { const audio = platform.application ? r.dispatch({ owner: CONTEXT, name: 'getSystemService', parameters: [STRING], result: OBJECT, signature: `(${STRING})${OBJECT}` }, [platform.application, 'audio'], 'virtual') : null; return audio ? [call(r, audio, 'Landroid/media/AudioManager;', 'getStreamVolume', ['I'], 'I', [3]), call(r, audio, 'Landroid/media/AudioManager;', 'getStreamMaxVolume', ['I'], 'I', [3])] : [0, 15]; };
  def(ROUTER, 'getDefaultRoute', `()${ROUTE}`, r => routerState(r).route);
  def(ROUTER, 'getSelectedRoute', `(I)${ROUTE}`, r => routerState(r).route);   // the default route stays selected for every type: there is no other route
  def(ROUTER, 'getSelectedRoute', `()${ROUTE}`, r => routerState(r).route);
  // routes and categories: the system ones, then the user routes the app added (createUserRoute / addUserRoute) and their categories
  const allRoutes = r => [routerState(r).route, ...routerState(r).userRoutes ?? []];
  const allCategories = r => { const out = [routerState(r).category]; for (const route of routerState(r).userRoutes ?? []) { const c = r.object(route).mediaRoute.category; if (!out.some(e => e.ref === c.ref)) out.push(c); } return out; };
  const at = (r, list, i) => { if (i < 0 || i >= list.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `Index: ${i}, Size: ${list.length}`); return list[i]; };
  def(ROUTER, 'getRouteCount', '()I', r => allRoutes(r).length); def(ROUTER, 'getCategoryCount', '()I', r => allCategories(r).length);
  def(ROUTER, 'getRouteAt', `(I)${ROUTE}`, (r, _m, [, i]) => at(r, allRoutes(r), i));
  def(ROUTER, 'getCategoryAt', `(I)${CATEGORY}`, (r, _m, [, i]) => at(r, allCategories(r), i));
  const USER_ROUTE = 'Landroid/media/MediaRouter$UserRouteInfo;';
  type(USER_ROUTE, ROUTE);
  def(ROUTER, 'createRouteCategory', `(${CHARSEQ}Z)${CATEGORY}`, (r, _m, [, name, groupable]) => { const c = r.makeObject(CATEGORY); r.object(c).mediaCategory = { name, groupable: !!groupable, types: 0x800000 }; return c; });   // ROUTE_TYPE_USER
  def(ROUTER, 'createRouteCategory', `(IZ)${CATEGORY}`, (r, _m, [, nameRes, groupable]) => { const c = r.makeObject(CATEGORY); r.object(c).mediaCategory = { nameRes, groupable: !!groupable, types: 0x800000 }; return c; });
  def(ROUTER, 'createUserRoute', `(${CATEGORY})${USER_ROUTE}`, (r, _m, [, category]) => { if (nullish(category)) npe(r, 'category'); const route = r.makeObject(USER_ROUTE); r.object(route).mediaRoute = { category, user: true, name: null, status: null, playbackType: 1, playbackStream: 3, volume: 0, volumeMax: 0, volumeHandling: 0 }; return route; });   // PLAYBACK_TYPE_REMOTE by default
  def(ROUTER, 'addUserRoute', `(${USER_ROUTE})V`, (r, _m, [, route]) => { const state = routerState(r); state.userRoutes ??= []; if (!state.userRoutes.some(e => e.ref === route.ref)) state.userRoutes.push(route); });
  def(ROUTER, 'removeUserRoute', `(${USER_ROUTE})V`, (r, _m, [, route]) => { const state = routerState(r); state.userRoutes = (state.userRoutes ?? []).filter(e => e.ref !== route?.ref); });
  def(ROUTER, 'clearUserRoutes', '()V', r => { routerState(r).userRoutes = []; });
  const userField = (name, signature, key) => def(USER_ROUTE, name, signature, (r, _m, [self, value]) => { r.object(self).mediaRoute[key] = value; });
  userField('setName', `(${CHARSEQ})V`, 'name'); userField('setStatus', `(${CHARSEQ})V`, 'status'); userField('setDescription', `(${CHARSEQ})V`, 'description');
  userField('setPlaybackType', '(I)V', 'playbackType'); userField('setPlaybackStream', '(I)V', 'playbackStream'); userField('setVolume', '(I)V', 'volume'); userField('setVolumeMax', '(I)V', 'volumeMax'); userField('setVolumeHandling', '(I)V', 'volumeHandling');
  userField('setVolumeCallback', '(Landroid/media/MediaRouter$VolumeCallback;)V', 'volumeCallback'); userField('setIconDrawable', '(Landroid/graphics/drawable/Drawable;)V', 'icon'); userField('setIconResource', '(I)V', 'iconRes');
  userField('setRemoteControlClient', '(Landroid/media/RemoteControlClient;)V', 'remoteControlClient'); userField('setName', '(I)V', 'nameRes');
  def(USER_ROUTE, 'getRemoteControlClient', '()Landroid/media/RemoteControlClient;', (r, _m, [self]) => r.object(self).mediaRoute.remoteControlClient ?? null);
  def(ROUTER, 'getFallbackRoute', `()${ROUTE}`, r => routerState(r).route);
  const addCallback = (r, _m, [, types, callback]) => { if (nullish(callback)) npe(r, 'callback'); const list = routerState(r).callbacks; if (!list.some(e => e.ref === callback.ref)) list.push(callback); };
  def(ROUTER, 'addCallback', `(I${ROUTER_CALLBACK})V`, addCallback); def(ROUTER, 'addCallback', `(I${ROUTER_CALLBACK}I)V`, addCallback);
  def(ROUTER, 'removeCallback', `(${ROUTER_CALLBACK})V`, (r, _m, [, callback]) => { const state = routerState(r); state.callbacks = state.callbacks.filter(e => e.ref !== callback?.ref); });
  def(ROUTER, 'selectRoute', `(I${ROUTE})V`, (r, _m, [, , route]) => { if (nullish(route)) iae(r, 'Route cannot be null.'); });   // the only route is already selected
  def(ROUTER, 'isRouteAvailable', `(II)Z`, (r, _m, [, types]) => ((types & SYSTEM_TYPES) !== 0 ? 1 : 0));
  const routeOf = (r, self) => r.object(self).mediaRoute; const routeName = (r, _m, [self]) => routeOf(r, self).user ? routeOf(r, self).name ?? null : 'Phone';
  def(ROUTE, 'getName', `()${CHARSEQ}`, routeName); def(ROUTE, 'getName', `(${CONTEXT})${CHARSEQ}`, routeName);
  def(ROUTE, 'getDescription', `()${CHARSEQ}`, (r, _m, [self]) => routeOf(r, self).description ?? null); def(ROUTE, 'getStatus', `()${CHARSEQ}`, (r, _m, [self]) => routeOf(r, self).status ?? null);
  const routeTypes = (r, self) => routeOf(r, self).user ? 0x800000 : SYSTEM_TYPES;
  def(ROUTE, 'getSupportedTypes', '()I', (r, _m, [self]) => routeTypes(r, self)); def(ROUTE, 'matchesTypes', '(I)Z', (r, _m, [self, types]) => ((types & routeTypes(r, self)) !== 0 ? 1 : 0));
  def(ROUTE, 'getCategory', `()${CATEGORY}`, (r, _m, [self]) => r.object(self).mediaRoute.category);
  def(ROUTE, 'getPlaybackType', '()I', (r, _m, [self]) => routeOf(r, self).user ? routeOf(r, self).playbackType : 0); def(ROUTE, 'getPlaybackStream', '()I', (r, _m, [self]) => routeOf(r, self).user ? routeOf(r, self).playbackStream : 3); def(ROUTE, 'getVolumeHandling', '()I', (r, _m, [self]) => routeOf(r, self).user ? routeOf(r, self).volumeHandling : 1);   // PLAYBACK_TYPE_LOCAL, STREAM_MUSIC, PLAYBACK_VOLUME_VARIABLE
  def(ROUTE, 'getVolume', '()I', (r, _m, [self]) => routeOf(r, self).user ? routeOf(r, self).volume : music(r)[0]); def(ROUTE, 'getVolumeMax', '()I', (r, _m, [self]) => routeOf(r, self).user ? routeOf(r, self).volumeMax : music(r)[1]);
  def(ROUTE, 'isEnabled', '()Z', () => 1); def(ROUTE, 'isConnecting', '()Z', () => 0); def(ROUTE, 'isDefault', '()Z', (r, _m, [self]) => (routeOf(r, self).user ? 0 : 1)); def(ROUTE, 'isBluetooth', '()Z', () => 0);
  def(ROUTE, 'getDeviceType', '()I', () => 0); def(ROUTE, 'getPresentationDisplay', '()Landroid/view/Display;', () => null); def(ROUTE, 'getIconDrawable', '()Landroid/graphics/drawable/Drawable;', () => null);
  def(ROUTE, 'getTag', `()${OBJECT}`, (r, _m, [self]) => r.object(self).mediaRoute.tag ?? null); def(ROUTE, 'setTag', `(${OBJECT})V`, (r, _m, [self, tag]) => { r.object(self).mediaRoute.tag = tag; });
  def(ROUTE, 'getGroup', '()Landroid/media/MediaRouter$RouteGroup;', () => null);
  const categoryName = (r, _m, [self]) => { const c = r.object(self).mediaCategory; return c ? c.name ?? null : 'System'; };
  def(CATEGORY, 'getName', `()${CHARSEQ}`, categoryName); def(CATEGORY, 'getName', `(${CONTEXT})${CHARSEQ}`, categoryName);
  def(CATEGORY, 'getSupportedTypes', '()I', (r, _m, [self]) => r.object(self).mediaCategory?.types ?? SYSTEM_TYPES); def(CATEGORY, 'isGroupable', '()Z', (r, _m, [self]) => (r.object(self).mediaCategory?.groupable ? 1 : 0)); def(CATEGORY, 'isSystem', '()Z', (r, _m, [self]) => (r.object(self).mediaCategory ? 0 : 1));

  // ---- android.media.session (MediaSession.java, MediaController.java, MediaSessionManager.java): sessions of this app and their controllers, in-process. The session's state
  // objects (PlaybackState, MediaMetadata, the queue, extras) are the app's own and pass through unchanged; a change is delivered to every registered controller callback on its
  // Handler, and a TransportControls command to the session callback on its Handler, after the call returns, as the session service does. Listing other apps' sessions needs
  // MEDIA_CONTENT_CONTROL (a system permission): a third-party app gets the SecurityException.
  const SESSION = 'Landroid/media/session/MediaSession;', TOKEN = 'Landroid/media/session/MediaSession$Token;', SESSION_CALLBACK = 'Landroid/media/session/MediaSession$Callback;';
  const CONTROLLER = 'Landroid/media/session/MediaController;', CONTROLLER_CALLBACK = 'Landroid/media/session/MediaController$Callback;', TRANSPORT = 'Landroid/media/session/MediaController$TransportControls;';
  const SESSION_MANAGER = service('media_session', 'Landroid/media/session/MediaSessionManager;'), DELIVERY = 'Lapkweb/bridge/MediaSessionDelivery;';
  const PSTATE = 'Landroid/media/session/PlaybackState;', META = 'Landroid/media/MediaMetadata;', RATING = 'Landroid/media/Rating;', BUNDLE = 'Landroid/os/Bundle;', URI = 'Landroid/net/Uri;';
  const HANDLER = 'Landroid/os/Handler;', LOOPER = 'Landroid/os/Looper;', RUNNABLE = 'Ljava/lang/Runnable;', PENDING = 'Landroid/app/PendingIntent;', CS = 'Ljava/lang/CharSequence;';
  type(SESSION, OBJECT, [], { allocatable: true }); type(TOKEN, OBJECT, ['Landroid/os/Parcelable;']); type(SESSION_CALLBACK, OBJECT, [], { allocatable: true });
  type(CONTROLLER, OBJECT, [], { allocatable: true }); type(CONTROLLER_CALLBACK, OBJECT, [], { allocatable: true }); type(TRANSPORT, OBJECT); type(DELIVERY, OBJECT, [RUNNABLE], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => { const record = r.object(self), task = record.task; record.task = null; record.held = null; return task?.(); });
  const post = (r, handler, task, held = []) => { const runnable = r.makeObject(DELIVERY), record = r.object(runnable); record.task = task; record.held = held.filter(v => !nullish(v)); call(r, handler, HANDLER, 'post', [RUNNABLE], 'Z', [runnable]); };
  const looperHandler = (r, handler) => {   // the Handler given, else one on the calling thread's Looper, else on the main Looper (MediaController.registerCallback / MediaSession.setCallback)
    if (!nullish(handler)) return handler;
    const statics = name => r.dispatch({ owner: LOOPER, name, parameters: [], result: LOOPER, signature: `()${LOOPER}` }, [], 'static');
    const looper = statics('myLooper'); return construct(r, HANDLER, [LOOPER], [nullish(looper) ? statics('getMainLooper') : looper]);
  };
  const sessionOf = (r, self) => r.object(self).mediaSession ?? ise(r, 'MediaSession used before it was constructed');
  const sessionCtor = (r, _m, [self, context, tag]) => {
    if (nullish(context)) iae(r, 'context cannot be null.'); if (nullish(tag) || text(r, tag) === '') iae(r, 'tag cannot be null or empty');
    const token = r.makeObject(TOKEN); r.object(token).sessionRef = self;
    r.object(self).mediaSession = { tag: text(r, tag), token, active: false, released: false, callback: null, handler: null, state: null, metadata: null, queue: null, queueTitle: null, extras: null, flags: 0, ratingType: 0, activity: null, controllers: [] };
  };
  def(SESSION, '<init>', `(${CONTEXT}${STRING})V`, sessionCtor); def(SESSION, '<init>', `(${CONTEXT}${STRING}${BUNDLE})V`, sessionCtor);
  const toControllers = (r, session, method, signature, value) => { for (const entry of session.controllers) post(r, entry.handler, () => { if (session.controllers.includes(entry)) call(r, entry.callback, CONTROLLER_CALLBACK, method, signature, 'V', value === undefined ? [] : [value]); }, [entry.callback, value]); };
  const setter = (name, signature, key, method) => def(SESSION, name, `(${signature})V`, (r, _m, [self, value]) => { const s = sessionOf(r, self); s[key] = nullish(value) ? null : value; if (method) toControllers(r, s, method, [signature], s[key]); });
  setter('setPlaybackState', PSTATE, 'state', 'onPlaybackStateChanged'); setter('setMetadata', META, 'metadata', 'onMetadataChanged'); setter('setQueue', LIST, 'queue', 'onQueueChanged');
  setter('setQueueTitle', CS, 'queueTitle', 'onQueueTitleChanged'); setter('setExtras', BUNDLE, 'extras', 'onExtrasChanged'); setter('setSessionActivity', PENDING, 'activity', null);
  setter('setMediaButtonReceiver', PENDING, 'buttonReceiver', null); setter('setMediaButtonBroadcastReceiver', 'Landroid/content/ComponentName;', 'buttonComponent', null);
  setter('setPlaybackToLocal', 'Landroid/media/AudioAttributes;', 'audioAttributes', null); setter('setPlaybackToRemote', 'Landroid/media/VolumeProvider;', 'volumeProvider', null);
  def(SESSION, 'setFlags', '(I)V', (r, _m, [self, flags]) => { sessionOf(r, self).flags = flags; }); def(SESSION, 'setRatingType', '(I)V', (r, _m, [self, type]) => { sessionOf(r, self).ratingType = type; });
  def(SESSION, 'setActive', '(Z)V', (r, _m, [self, active]) => { sessionOf(r, self).active = !!active; }); def(SESSION, 'isActive', '()Z', (r, _m, [self]) => (sessionOf(r, self).active ? 1 : 0));
  const setCallback = (r, _m, [self, callback, handler]) => { const s = sessionOf(r, self); s.callback = nullish(callback) ? null : callback; s.handler = nullish(callback) ? null : looperHandler(r, handler ?? null); };
  def(SESSION, 'setCallback', `(${SESSION_CALLBACK})V`, setCallback); def(SESSION, 'setCallback', `(${SESSION_CALLBACK}${HANDLER})V`, setCallback);
  def(SESSION, 'sendSessionEvent', `(${STRING}${BUNDLE})V`, (r, _m, [self, event, extras]) => { if (nullish(event) || text(r, event) === '') iae(r, 'event cannot be null or empty'); const s = sessionOf(r, self); for (const entry of s.controllers) post(r, entry.handler, () => call(r, entry.callback, CONTROLLER_CALLBACK, 'onSessionEvent', [STRING, BUNDLE], 'V', [event, extras]), [entry.callback, event, extras]); });
  def(SESSION, 'getSessionToken', `()${TOKEN}`, (r, _m, [self]) => sessionOf(r, self).token);
  def(SESSION, 'getController', `()${CONTROLLER}`, (r, _m, [self, ]) => { const s = sessionOf(r, self); return s.controller ??= (() => { const c = r.makeObject(CONTROLLER); r.object(c).mediaController = { session: self }; return c; })(); });
  def(SESSION, 'release', '()V', (r, _m, [self]) => { const s = sessionOf(r, self); if (s.released) return; s.released = true; s.active = false; const entries = s.controllers.splice(0); for (const entry of entries) post(r, entry.handler, () => call(r, entry.callback, CONTROLLER_CALLBACK, 'onSessionDestroyed', [], 'V', []), [entry.callback]); });
  def(TOKEN, 'describeContents', '()I', () => 0);
  def(TOKEN, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => (!nullish(other) && r.object(other).sessionRef?.ref === r.object(self).sessionRef?.ref ? 1 : 0));
  def(TOKEN, 'hashCode', '()I', (r, _m, [self]) => r.object(self).sessionRef?.ref ?? 0);
  // MediaSession.QueueItem (nested in MediaSession.java): a MediaDescription with a queue id; the id must not be UNKNOWN_ID (-1)
  const QUEUE_ITEM = 'Landroid/media/session/MediaSession$QueueItem;', DESCRIPTION = 'Landroid/media/MediaDescription;';
  type(QUEUE_ITEM, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true });
  def(QUEUE_ITEM, '<init>', `(${DESCRIPTION}J)V`, (r, _m, [self, description, id]) => { if (nullish(description)) iae(r, 'Description cannot be null'); if (BigInt(id) === -1n) iae(r, 'Id cannot be QueueItem.UNKNOWN_ID'); r.object(self).queueItem = { description, id: BigInt(id) }; });
  def(QUEUE_ITEM, 'getDescription', `()${DESCRIPTION}`, (r, _m, [self]) => r.object(self).queueItem.description);
  def(QUEUE_ITEM, 'getQueueId', '()J', (r, _m, [self]) => r.object(self).queueItem.id);
  def(QUEUE_ITEM, 'describeContents', '()I', () => 0);
  // MediaSession.Callback: every method is empty on the base class (the app overrides what it handles)
  def(SESSION_CALLBACK, '<init>', '()V', () => {});
  for (const [name, signature] of [['onPrepare', '()V'], ['onPrepareFromMediaId', `(${STRING}${BUNDLE})V`], ['onPrepareFromSearch', `(${STRING}${BUNDLE})V`], ['onPrepareFromUri', `(${URI}${BUNDLE})V`], ['onPlay', '()V'], ['onPlayFromSearch', `(${STRING}${BUNDLE})V`], ['onPlayFromMediaId', `(${STRING}${BUNDLE})V`], ['onPlayFromUri', `(${URI}${BUNDLE})V`], ['onSkipToQueueItem', '(J)V'], ['onPause', '()V'], ['onSkipToNext', '()V'], ['onSkipToPrevious', '()V'], ['onFastForward', '()V'], ['onRewind', '()V'], ['onStop', '()V'], ['onSeekTo', '(J)V'], ['onSetRating', `(${RATING})V`], ['onSetPlaybackSpeed', '(F)V'], ['onCustomAction', `(${STRING}${BUNDLE})V`], ['onCommand', `(${STRING}${BUNDLE}Landroid/os/ResultReceiver;)V`]]) def(SESSION_CALLBACK, name, signature, () => {});
  def(SESSION_CALLBACK, 'onMediaButtonEvent', '(Landroid/content/Intent;)Z', () => 0);
  // MediaController over a session of this process
  const controllerOf = (r, self) => r.object(self).mediaController ?? ise(r, 'MediaController used before it was constructed');
  const sessionBehind = (r, self) => sessionOf(r, controllerOf(r, self).session);
  def(CONTROLLER, '<init>', `(${CONTEXT}${TOKEN})V`, (r, _m, [self, context, token]) => { if (nullish(context)) iae(r, 'context shouldn\'t be null'); if (nullish(token)) iae(r, 'token shouldn\'t be null'); const ref = r.object(token).sessionRef; if (!ref) iae(r, 'token is not a session of this device'); r.object(self).mediaController = { session: ref }; });
  for (const [name, result, key] of [['getPlaybackState', PSTATE, 'state'], ['getMetadata', META, 'metadata'], ['getQueue', LIST, 'queue'], ['getQueueTitle', CS, 'queueTitle'], ['getExtras', BUNDLE, 'extras'], ['getSessionActivity', PENDING, 'activity']]) def(CONTROLLER, name, `()${result}`, (r, _m, [self]) => sessionBehind(r, self)[key] ?? null);
  def(CONTROLLER, 'getFlags', '()J', (r, _m, [self]) => BigInt(sessionBehind(r, self).flags)); def(CONTROLLER, 'getRatingType', '()I', (r, _m, [self]) => sessionBehind(r, self).ratingType);
  def(CONTROLLER, 'getPackageName', `()${STRING}`, () => platform.packageName); def(CONTROLLER, 'getTag', `()${STRING}`, (r, _m, [self]) => sessionBehind(r, self).tag);
  def(CONTROLLER, 'getSessionToken', `()${TOKEN}`, (r, _m, [self]) => sessionBehind(r, self).token);
  const register = (r, _m, [self, callback, handler]) => { if (nullish(callback)) iae(r, 'callback must not be null'); const s = sessionBehind(r, self); if (!s.controllers.some(e => e.callback.ref === callback.ref)) s.controllers.push({ callback, handler: looperHandler(r, handler ?? null) }); };
  def(CONTROLLER, 'registerCallback', `(${CONTROLLER_CALLBACK})V`, register); def(CONTROLLER, 'registerCallback', `(${CONTROLLER_CALLBACK}${HANDLER})V`, register);
  def(CONTROLLER, 'unregisterCallback', `(${CONTROLLER_CALLBACK})V`, (r, _m, [self, callback]) => { if (nullish(callback)) iae(r, 'callback must not be null'); const s = sessionBehind(r, self); s.controllers = s.controllers.filter(e => e.callback.ref !== callback.ref); });
  def(CONTROLLER, 'getTransportControls', `()${TRANSPORT}`, (r, _m, [self]) => { const c = controllerOf(r, self); return c.transport ??= (() => { const t = r.makeObject(TRANSPORT); r.object(t).transportSession = c.session; return t; })(); });
  def(CONTROLLER_CALLBACK, '<init>', '()V', () => {});
  for (const [name, signature] of [['onSessionDestroyed', '()V'], ['onSessionEvent', `(${STRING}${BUNDLE})V`], ['onPlaybackStateChanged', `(${PSTATE})V`], ['onMetadataChanged', `(${META})V`], ['onQueueChanged', `(${LIST})V`], ['onQueueTitleChanged', `(${CS})V`], ['onExtrasChanged', `(${BUNDLE})V`], ['onAudioInfoChanged', '(Landroid/media/session/MediaController$PlaybackInfo;)V']]) def(CONTROLLER_CALLBACK, name, signature, () => {});
  // TransportControls: each command reaches the session callback on its Handler (nothing happens when the session has no callback or was released)
  const command = (name, signature) => def(TRANSPORT, name, `(${signature.join('')})V`, (r, _m, [self, ...args]) => {
    const s = sessionOf(r, r.object(self).transportSession); if (s.released || !s.callback) return;
    const target = { play: 'onPlay', pause: 'onPause', stop: 'onStop', skipToNext: 'onSkipToNext', skipToPrevious: 'onSkipToPrevious', fastForward: 'onFastForward', rewind: 'onRewind', seekTo: 'onSeekTo', prepare: 'onPrepare', playFromMediaId: 'onPlayFromMediaId', playFromSearch: 'onPlayFromSearch', playFromUri: 'onPlayFromUri', prepareFromMediaId: 'onPrepareFromMediaId', prepareFromSearch: 'onPrepareFromSearch', prepareFromUri: 'onPrepareFromUri', skipToQueueItem: 'onSkipToQueueItem', setRating: 'onSetRating', setPlaybackSpeed: 'onSetPlaybackSpeed', sendCustomAction: 'onCustomAction' }[name];
    const callback = s.callback; post(r, s.handler, () => call(r, callback, SESSION_CALLBACK, target, signature, 'V', args), [callback, ...args]);
  });
  for (const name of ['play', 'pause', 'stop', 'skipToNext', 'skipToPrevious', 'fastForward', 'rewind', 'prepare']) command(name, []);
  command('seekTo', ['J']); command('skipToQueueItem', ['J']); command('setRating', [RATING]); command('setPlaybackSpeed', ['F']); command('sendCustomAction', [STRING, BUNDLE]);
  for (const name of ['playFromMediaId', 'playFromSearch', 'prepareFromMediaId', 'prepareFromSearch']) command(name, [STRING, BUNDLE]);
  for (const name of ['playFromUri', 'prepareFromUri']) command(name, [URI, BUNDLE]);
  // MediaSessionManager: other apps' sessions are not this app's to see
  const denied = r => r.throwJava('Ljava/lang/SecurityException;', 'Missing permission to control media.');
  def(SESSION_MANAGER, 'getActiveSessions', `(Landroid/content/ComponentName;)${LIST}`, r => denied(r));
  def(SESSION_MANAGER, 'addOnActiveSessionsChangedListener', '(Landroid/media/session/MediaSessionManager$OnActiveSessionsChangedListener;Landroid/content/ComponentName;)V', r => denied(r));
  def(SESSION_MANAGER, 'removeOnActiveSessionsChangedListener', '(Landroid/media/session/MediaSessionManager$OnActiveSessionsChangedListener;)V', () => {});
  def(SESSION_MANAGER, 'getSession2Tokens', `()${LIST}`, r => emptyList(r));

  installSoundPool({ platform, registry, nullish, iae, construct, call });   // android.media.SoundPool (src/sound-pool-host.js)

  const base = kit.finish({ nullServices: NULL_SERVICES });
  return {
    ...base,
    getService: (r, name) => (NULL_SERVICES.includes(name) ? null : kit.getService(r, name)),
  };
}
