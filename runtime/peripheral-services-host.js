import { bitsFloat, floatBits } from './host-contract.js?v=d50f2f368405';
import { createServiceKit, OBJECT, STRING, LIST, DEVICE_FEATURES } from './service-kit.js?v=d50f2f368405';

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
  def(WIFI, 'getMaxSignalLevel', '()I', () => 4);
  def(WIFI, 'calculateSignalLevel', '(II)I', (r, _m, [rssi, levels]) => { if (levels <= 1) iae(r, 'numLevels ' + levels + ' must be at least 2'); return rssi <= -100 ? 0 : rssi >= -55 ? levels - 1 : Math.trunc((rssi + 100) * (levels - 1) / 45); }, { static: true });
  def(WIFI, 'compareSignalLevel', '(II)I', (r, _m, [a, b]) => a - b, { static: true });
  def(WIFI, 'getConnectionInfo', `()${WIFI_INFO}`, r => { enforce(r, 'android.permission.ACCESS_WIFI_STATE'); const info = r.allocate(WIFI_INFO); r.object(info).wifiInfo = { connected: connected(), location: kit.holds(r, 'android.permission.ACCESS_FINE_LOCATION') }; return info; });
  const info = (r, ref) => r.object(ref).wifiInfo ?? npe(r, 'WifiInfo used before it was obtained');
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
  const newLock = (r, owner, kind, tag) => { const o = r.allocate(owner); r.object(o).lockState = { kind, tag: (tag === null || tag === 0) ? null : text(r, tag), held: false, counted: true, count: 0 }; return o; };
  def(WIFI, 'createWifiLock', `(${STRING})${WIFI_LOCK}`, (r, _m, [, tag]) => newLock(r, WIFI_LOCK, 'WifiLock', tag));
  def(WIFI, 'createWifiLock', `(I${STRING})${WIFI_LOCK}`, (r, _m, [, mode, tag]) => { if (![1, 2, 3, 4].includes(mode)) iae(r, `Illegal argument, lockType ${mode}`); return newLock(r, WIFI_LOCK, 'WifiLock', tag); });
  def(WIFI, 'createMulticastLock', `(${STRING})${MULTICAST_LOCK}`, (r, _m, [, tag]) => newLock(r, MULTICAST_LOCK, 'MulticastLock', tag));

  // ---- BluetoothManager / NfcManager: the services exist, the adapters do not (SystemServer starts Bluetooth/NFC only with the feature)
  const BLUETOOTH = service('bluetooth', 'Landroid/bluetooth/BluetoothManager;'), NFC = service('nfc', 'Landroid/nfc/NfcManager;');
  def(BLUETOOTH, 'getAdapter', '()Landroid/bluetooth/BluetoothAdapter;', () => null);
  const gattProfile = (r, profile) => { if (profile !== 7 && profile !== 8) iae(r, `Profile not supported: ${profile}`); };   // BluetoothProfile.GATT / GATT_SERVER
  def(BLUETOOTH, 'getConnectedDevices', `(I)${LIST}`, (r, _m, [, profile]) => { gattProfile(r, profile); return emptyList(r); });
  def(BLUETOOTH, 'getDevicesMatchingConnectionStates', `(I[I)${LIST}`, (r, _m, [, profile]) => { gattProfile(r, profile); return emptyList(r); });
  def(BLUETOOTH, 'getConnectionState', '(Landroid/bluetooth/BluetoothDevice;I)I', (r, _m, [, , profile]) => { gattProfile(r, profile); return 0; });
  def(NFC, 'getDefaultAdapter', '()Landroid/nfc/NfcAdapter;', () => (hasFeature('android.hardware.nfc') ? npe(null) : null));

  // ---- CameraManager: no cameras
  const CAMERA = service('camera', 'Landroid/hardware/camera2/CameraManager;');
  def(CAMERA, 'getCameraIdList', `()[${STRING}`, r => stringArray(r, []));
  def(CAMERA, 'getConcurrentCameraIds', '()Ljava/util/Set;', r => construct(r, 'Ljava/util/HashSet;'));
  def(CAMERA, 'registerAvailabilityCallback', '(Landroid/hardware/camera2/CameraManager$AvailabilityCallback;Landroid/os/Handler;)V', (r, _m, [, callback]) => { if (nullish(callback)) iae(r, 'callback must not be null'); });
  def(CAMERA, 'unregisterAvailabilityCallback', '(Landroid/hardware/camera2/CameraManager$AvailabilityCallback;)V', (r, _m, [, callback]) => { if (nullish(callback)) iae(r, 'callback must not be null'); });
  def(CAMERA, 'registerTorchCallback', '(Landroid/hardware/camera2/CameraManager$TorchCallback;Landroid/os/Handler;)V', (r, _m, [, callback]) => { if (nullish(callback)) iae(r, 'callback must not be null'); });
  def(CAMERA, 'unregisterTorchCallback', '(Landroid/hardware/camera2/CameraManager$TorchCallback;)V', (r, _m, [, callback]) => { if (nullish(callback)) iae(r, 'callback must not be null'); });
  const unknownCamera = (r, id) => { if (nullish(id)) iae(r, 'cameraId was null'); iae(r, `Unable to retrieve camera characteristics for unknown device ${text(r, id)}`); };
  def(CAMERA, 'getCameraCharacteristics', `(${STRING})Landroid/hardware/camera2/CameraCharacteristics;`, (r, _m, [, id]) => unknownCamera(r, id));
  def(CAMERA, 'setTorchMode', `(${STRING}Z)V`, (r, _m, [, id]) => { if (nullish(id)) iae(r, 'cameraId was null'); iae(r, `Camera ${text(r, id)} is not a flashlight device`); });
  def(CAMERA, 'openCamera', `(${STRING}Landroid/hardware/camera2/CameraDevice$StateCallback;Landroid/os/Handler;)V`, (r, _m, [, id]) => unknownCamera(r, id));

  // ---- UsbManager: no host or accessory port, so no devices
  const USB = service('usb', 'Landroid/hardware/usb/UsbManager;');
  def(USB, 'getDeviceList', '()Ljava/util/HashMap;', r => construct(r, 'Ljava/util/HashMap;'));
  def(USB, 'getAccessoryList', '()[Landroid/hardware/usb/UsbAccessory;', () => null);
  def(USB, 'hasPermission', '(Landroid/hardware/usb/UsbDevice;)Z', (r, _m, [, usbDevice]) => { if (nullish(usbDevice)) return 0; return 0; });

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

  const base = kit.finish({ nullServices: NULL_SERVICES });
  return {
    ...base,
    getService: (r, name) => (NULL_SERVICES.includes(name) ? null : kit.getService(r, name)),
  };
}
