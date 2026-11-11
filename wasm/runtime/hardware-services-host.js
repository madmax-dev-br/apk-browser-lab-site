import { APKError } from './apk-error.js?v=346cde125f88';
import { gcRoot } from './heap-gc.js?v=346cde125f88';
import { installAudioManager, installRingtoneManager } from './audio-manager-host.js?v=346cde125f88';
import { createHostRegistry, doubleBits, floatBits } from './host-contract.js?v=346cde125f88';
import { GC_ROOTS } from './heap-gc.js?v=346cde125f88';

// System services for the hardware and device state a browser tab does not have, answered the way a real device with that hardware absent answers (android-13.0.0_r1 service
// contracts): no screen lock (KeyguardManager), no vibrator motor, no sensors, no GPS, no fingerprint/biometric hardware, an audio mixer with default volumes
// (AlarmManager is Java now: src/java-services-host.js, docs/SERVICES.md). Each service exists only through this contract; Context.getSystemService returns it for the service name or its class.
const RUNNABLE = 'Ljava/lang/Runnable;', DELIVERY = 'Lapkweb/bridge/LocationDelivery;', OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', PENDING = 'Landroid/app/PendingIntent;', CONTEXT = 'Landroid/content/Context;';

export function createHardwareServicesHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const services = new Map(), byClass = new Map(), objects = new WeakMap();
  const service = (name, classType, hostType = classType.replace(/;$/, '') + 'Impl;') => { services.set(name, hostType); byClass.set(classType, name); type(classType, OBJECT, [], { allocatable: false }); type(hostType, classType, [], { allocatable: true }); return hostType; };
  const getService = (r, name) => {
    const hostType = services.get(name); if (!hostType) return null;
    const cache = objects.get(r) ?? objects.set(r, gcRoot(new Map())).get(r);
    if (!cache.has(name)) cache.set(name, r.allocate(hostType));
    return cache.get(name);
  };
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const text = (r, v) => v === null ? null : r.stringCharacters(v);
  const holds = (r, permission) => platform.holdsPermission?.(r, permission) ?? false;
  const emptyList = r => { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); return list; };
  const stringArray = (r, items) => { const a = r.newArray('[Ljava/lang/String;', items.length); r.array(a).elements = items; return a; };
  const device = () => platform.device ?? {};

  // ---- KeyguardManager: the virtual device has no screen lock --------------------------------------------------------------------------------------
  const KEYGUARD = service('keyguard', 'Landroid/app/KeyguardManager;');
  for (const name of ['isKeyguardLocked', 'isKeyguardSecure', 'isDeviceLocked', 'isDeviceSecure', 'inKeyguardRestrictedInputMode']) def(KEYGUARD, name, '()Z', () => 0);
  def(KEYGUARD, 'isDeviceLocked', '(I)Z', () => 0); def(KEYGUARD, 'isDeviceSecure', '(I)Z', () => 0);
  def(KEYGUARD, 'createConfirmDeviceCredentialIntent', `(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/Intent;`, () => null);   // documented: null when the device is not secure

  // ---- Vibrator / VibrationEffect: no vibration motor, so vibrate() is the documented no-op -----------------------------------------------------------------
  const VIBRATOR = service('vibrator', 'Landroid/os/Vibrator;'), EFFECT = 'Landroid/os/VibrationEffect;';
  type(EFFECT, OBJECT, [], { allocatable: true });
  def(VIBRATOR, 'hasVibrator', '()Z', () => 0); def(VIBRATOR, 'hasAmplitudeControl', '()Z', () => 0); def(VIBRATOR, 'cancel', '()V', () => {});
  // API 30+ capability queries Compose's HapticDefaults and apps make: a device without a vibration motor supports no primitives and no effects (EFFECT_SUPPORT_NO = 2).
  def(VIBRATOR, 'hasFrequencyControl', '()Z', () => 0); def(VIBRATOR, 'isVibrating', '()Z', () => 0); def(VIBRATOR, 'getId', '()I', () => 0);
  def(VIBRATOR, 'areAllPrimitivesSupported', '([I)Z', () => 0); def(VIBRATOR, 'areAllEffectsSupported', '([I)I', () => 2);
  for (const signature of ['(J)V', '([JI)V', `(${EFFECT})V`, `(${EFFECT}Landroid/media/AudioAttributes;)V`, '(JLandroid/media/AudioAttributes;)V', '([JILandroid/media/AudioAttributes;)V']) def(VIBRATOR, 'vibrate', signature, () => {});
  def(EFFECT, 'createOneShot', `(JI)${EFFECT}`, (r, _m, [, ms, amplitude]) => { if (BigInt(ms) <= 0n) r.throwJava('Ljava/lang/IllegalArgumentException;', 'timing must be positive'); if (amplitude === 0 || amplitude < -1 || amplitude > 255) r.throwJava('Ljava/lang/IllegalArgumentException;', 'amplitude must either be DEFAULT_AMPLITUDE, or between 1 and 255 inclusive (amplitude=' + amplitude + ')'); return r.allocate(EFFECT); }, { static: true });
  for (const signature of [`([JI)${EFFECT}`, `([J[II)${EFFECT}`, `(I)${EFFECT}`]) def(EFFECT, signature.startsWith('(I') ? 'createPredefined' : 'createWaveform', signature, r => r.allocate(EFFECT), { static: true });
  registry.staticField(EFFECT, 'DEFAULT_AMPLITUDE', 'I', () => -1);
  for (const [name, value] of Object.entries({ EFFECT_CLICK: 0, EFFECT_DOUBLE_CLICK: 1, EFFECT_TICK: 2, EFFECT_HEAVY_CLICK: 5 })) registry.staticField(EFFECT, name, 'I', () => value);

  // ---- AudioManager: src/audio-manager-host.js (volumes, ringer/DND rule, focus stack, devices, session ids) ---------------------------------------------------
  const audioManager = installAudioManager({ platform, def, service, call, holds, emptyList }), ringtones = installRingtoneManager({ platform, def, type, holds });

  // ---- LocationManager (android-13.0.0_r1 LocationManager / LocationManagerService) ----------------------------------------------------------------------------------------------------------
  // The providers exist (passive, gps, network, fused). Location is off by default, like an emulator with the setting off: isLocationEnabled/isProviderEnabled are false, there is no last location,
  // getCurrentLocation answers null and a listener registered on a disabled provider hears onProviderDisabled right away (documented in LocationListener). The "Permissões" section of the page can
  // turn location on and give the device a position (platform.locationSimulation): then the providers are enabled, getLastKnownLocation / getCurrentLocation return that fix and registered
  // listeners hear it, on their Looper or Executor, when it is registered and each time it changes. Permission checks throw SecurityException like LocationPermissions.enforceLocationPermission.
  // minTime / minDistance are not applied (every change is delivered). GNSS callbacks register but never fire. Google Play services' fused client does not exist on this device.
  const LOCATION = service('location', 'Landroid/location/LocationManager;');
  const LISTENER = 'Landroid/location/LocationListener;', LOC = 'Landroid/location/Location;', LOOPER = 'Landroid/os/Looper;', EXECUTOR = 'Ljava/util/concurrent/Executor;', CONSUMER = 'Ljava/util/function/Consumer;', SIGNAL = 'Landroid/os/CancellationSignal;', CRITERIA = 'Landroid/location/Criteria;', LREQUEST = 'Landroid/location/LocationRequest;', GNSS_CB = 'Landroid/location/GnssStatus$Callback;', HANDLER = 'Landroid/os/Handler;', INTENT = 'Landroid/content/Intent;';
  const PROVIDERS = ['passive', 'gps', 'network', 'fused'], FINE_ONLY = new Set(['gps', 'passive']);
  const registrations = gcRoot(new Map());   // listener / PendingIntent ref -> { provider, handle }
  const iae = (r, m) => r.throwJava('Ljava/lang/IllegalArgumentException;', m);
  const provider_ = (r, v) => { if (v === null || v === 0) iae(r, 'invalid provider: null'); return text(r, v); };
  const enforce = (r, provider) => {
    const fine = holds(r, 'android.permission.ACCESS_FINE_LOCATION'), coarse = holds(r, 'android.permission.ACCESS_COARSE_LOCATION'), uid = platform.virtualProcess?.uid ?? 10000;
    if (FINE_ONLY.has(provider)) { if (!fine) r.throwJava('Ljava/lang/SecurityException;', `uid ${uid} does not have android.permission.ACCESS_FINE_LOCATION.`); }
    else if (!fine && !coarse) r.throwJava('Ljava/lang/SecurityException;', `uid ${uid} does not have android.permission.ACCESS_COARSE_LOCATION or android.permission.ACCESS_FINE_LOCATION.`);
  };
  const providerOfRequest = (r, request) => { const name = call(r, request, LREQUEST, 'getProvider', [], STRING); return text(r, name); };
  // The simulated location (the "Permissões" section of the page: platform.locationSimulation = { enabled, latitude, longitude, accuracy, time, elapsedNanos, version }, null until the page sends it).
  const sim = () => platform.locationSimulation ?? null;
  const enabled = () => !!sim()?.enabled;
  const hasFix = () => { const s = sim(); return !!s && s.enabled && s.hasFix !== false; };
  def(LOCATION, 'isLocationEnabled', '()Z', () => (enabled() ? 1 : 0));
  def(LOCATION, 'isLocationEnabledForUser', '(Landroid/os/UserHandle;)Z', () => (enabled() ? 1 : 0));
  def(LOCATION, 'isProviderEnabled', `(${STRING})Z`, (r, _m, [, provider]) => (enabled() && PROVIDERS.includes(provider_(r, provider)) ? 1 : 0));
  def(LOCATION, 'isProviderEnabledForUser', `(${STRING}Landroid/os/UserHandle;)Z`, (r, _m, [, provider]) => (enabled() && PROVIDERS.includes(provider_(r, provider)) ? 1 : 0));
  def(LOCATION, 'hasProvider', `(${STRING})Z`, (r, _m, [, provider]) => PROVIDERS.includes(provider_(r, provider)) ? 1 : 0);
  const providerList = (r, names) => { const list = emptyList(r); for (const name of names) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [name]); return list; };
  def(LOCATION, 'getAllProviders', '()Ljava/util/List;', r => providerList(r, PROVIDERS));
  def(LOCATION, 'getProviders', '(Z)Ljava/util/List;', (r, _m, [, enabledOnly]) => providerList(r, enabledOnly && !enabled() ? [] : PROVIDERS));
  def(LOCATION, 'getBestProvider', `(${CRITERIA}Z)${STRING}`, (r, _m, [, criteria, enabledOnly]) => {
    if (criteria === null) iae(r, 'criteria must not be null');
    if (enabledOnly && !enabled()) return null;   // no provider is enabled
    throw new APKError('LocationManager.getBestProvider(criteria, ...): matching Criteria against provider properties is not modelled', { kind: 'unsupported-location' });
  });
  // The Location a provider reports: the simulated values, stamped with the virtual clock at the moment they last changed. With only ACCESS_COARSE_LOCATION the fix is coarsened to a grid of the
  // 2000 m coarse accuracy (LocationFudger in AOSP also adds a stable random offset, which is not modelled).
  const COARSE_METERS = 2000;
  const coarsen = (value, meters, latitude) => { const step = meters / (latitude ? 111320 : 111320 * Math.max(0.01, Math.cos(sim().latitude * Math.PI / 180))); return Math.round(value / step) * step; };
  const makeLocation = (r, provider) => {
    const s = sim(), fine = holds(r, 'android.permission.ACCESS_FINE_LOCATION');
    const latitude = fine ? s.latitude : coarsen(s.latitude, COARSE_METERS, true), longitude = fine ? s.longitude : coarsen(s.longitude, COARSE_METERS, false), accuracy = fine ? s.accuracy : Math.max(s.accuracy, COARSE_METERS);
    const location = r.allocate(LOC); r.dispatch({ owner: LOC, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [location, provider], 'direct');
    const wide = (name, parameters, values) => r.dispatch({ owner: LOC, name, parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, values, { receiver: location }), 'virtual');   // D and J take two argument words
    wide('setLatitude', ['D'], [doubleBits(latitude)]); wide('setLongitude', ['D'], [doubleBits(longitude)]); wide('setAccuracy', ['F'], [floatBits(accuracy)]);
    wide('setTime', ['J'], [BigInt(s.time)]); wide('setElapsedRealtimeNanos', ['J'], [BigInt(s.elapsedNanos)]);
    return location;
  };
  def(LOCATION, 'getLastKnownLocation', `(${STRING})${LOC}`, (r, _m, [, provider]) => {
    const name = provider_(r, provider); enforce(r, name);
    return hasFix() && PROVIDERS.includes(name) ? makeLocation(r, name) : null;
  });
  // Deliveries run on the Looper (or Executor) the app registered with; without one, on the main queue.
  type(DELIVERY, OBJECT, [RUNNABLE], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => r.object(self).task());
  const deliverOn = (r, target, task, roots) => {
    if (target?.executor) { const runnable = r.allocate(DELIVERY); r.object(runnable).task = task; r.object(runnable).held = roots; call(r, target.executor, EXECUTOR, 'execute', [RUNNABLE], 'V', [runnable]); return; }
    if (target?.looper) {
      const handler = r.allocate(HANDLER); r.dispatch({ owner: HANDLER, name: '<init>', parameters: [LOOPER], result: 'V', signature: `(${LOOPER})V` }, [handler, target.looper], 'direct');
      const runnable = r.allocate(DELIVERY); r.object(runnable).task = task; r.object(runnable).held = [...roots, handler]; call(r, handler, HANDLER, 'post', [RUNNABLE], 'Z', [runnable]); return;
    }
    platform.queueTask(task, 0, roots);
  };
  // updates: validation order of LocationManager.requestLocationUpdates, then the registration. With location on and a fix, the first fix is delivered at once (a registered listener of a provider
  // with a last location hears it); a disabled provider reports onProviderDisabled; later changes of the simulated values (and the switch) are delivered by platform.locationChanged below.
  const registerListener = (r, key, provider, hooks, target = null, single = false) => {
    if (key === null || key === 0) iae(r, 'invalid listener: null');
    enforce(r, provider);
    if (!PROVIDERS.includes(provider)) iae(r, `provider "${provider}" does not exist`);
    const record = { provider, key, cancelled: false, hooks, target, single, looper: target?.looper ?? null, executor: target?.executor ?? null }; registrations.set(key.ref ?? key, record);
    deliverOn(r, target, () => { if (record.cancelled) return; if (hasFix()) { hooks.location(makeLocation(r, provider)); if (single) { record.cancelled = true; registrations.delete(key.ref ?? key); } } else if (!enabled()) hooks.disabled(); }, [key, ...(target ? [target.looper, target.executor].filter(Boolean) : [])]);
  };
  const toListener = (r, listener, provider) => ({
    disabled: () => call(r, listener, LISTENER, 'onProviderDisabled', [STRING], 'V', [provider]),
    enabled: () => call(r, listener, LISTENER, 'onProviderEnabled', [STRING], 'V', [provider]),
    location: location => call(r, listener, LISTENER, 'onLocationChanged', [LOC], 'V', [location]),
  });
  const toIntent = (r, pending, provider) => {
    const send = (extras) => {
      const intent = r.allocate(INTENT); r.dispatch({ owner: INTENT, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [intent], 'direct');
      for (const [name, type, value] of extras) call(r, intent, INTENT, 'putExtra', [STRING, type], INTENT, [name, value]);
      r.dispatch({ owner: PENDING, name: 'send', parameters: [CONTEXT, 'I', INTENT], result: 'V', signature: `(${CONTEXT}I${INTENT})V` }, [pending, platform.application, 0, intent], 'virtual');
    };
    return { disabled: () => send([['providerEnabled', 'Z', 0]]), enabled: () => send([['providerEnabled', 'Z', 1]]), location: location => send([['location', 'Landroid/os/Parcelable;', location]]) };
  };
  const requestArgs = (r, provider, listener) => { const name = provider_(r, provider); return [name, listener]; };
  const listen = (r, provider, listener, target, single) => { const [name] = requestArgs(r, provider, listener); registerListener(r, listener, name, toListener(r, listener, name), target, single); };
  const pend = (r, provider, pending, single) => { const name = provider_(r, provider); registerListener(r, pending, name, toIntent(r, pending, name), null, single); };
  def(LOCATION, 'requestLocationUpdates', `(${STRING}JF${LISTENER}${LOOPER})V`, (r, _m, [, provider, , , listener, looper]) => listen(r, provider, listener, looper === null || looper === 0 ? null : { looper }, false));
  def(LOCATION, 'requestLocationUpdates', `(${STRING}JF${LISTENER})V`, (r, _m, [, provider, , , listener]) => listen(r, provider, listener, null, false));
  def(LOCATION, 'requestLocationUpdates', `(${STRING}JF${EXECUTOR}${LISTENER})V`, (r, _m, [, provider, , , executor, listener]) => listen(r, provider, listener, executor === null || executor === 0 ? null : { executor }, false));
  def(LOCATION, 'requestLocationUpdates', `(${STRING}JF${PENDING})V`, (r, _m, [, provider, , , pending]) => pend(r, provider, pending, false));
  def(LOCATION, 'requestLocationUpdates', `(${STRING}${LREQUEST}${EXECUTOR}${LISTENER})V`, (r, _m, [, provider, , executor, listener]) => listen(r, provider, listener, executor === null || executor === 0 ? null : { executor }, false));
  def(LOCATION, 'requestLocationUpdates', `(${STRING}${LREQUEST}${PENDING})V`, (r, _m, [, provider, , pending]) => pend(r, provider, pending, false));
  def(LOCATION, 'requestLocationUpdates', `(${LREQUEST}${EXECUTOR}${LISTENER})V`, (r, _m, [, request, executor, listener]) => { if (request === null) iae(r, 'invalid null request'); const name = providerOfRequest(r, request); registerListener(r, listener, name, toListener(r, listener, name), executor === null || executor === 0 ? null : { executor }, false); });
  def(LOCATION, 'requestSingleUpdate', `(${STRING}${LISTENER}${LOOPER})V`, (r, _m, [, provider, listener, looper]) => listen(r, provider, listener, looper === null || looper === 0 ? null : { looper }, true));
  def(LOCATION, 'requestSingleUpdate', `(${STRING}${PENDING})V`, (r, _m, [, provider, pending]) => pend(r, provider, pending, true));
  const remove = (r, _m, [, key]) => { if (key === null || key === 0) iae(r, 'invalid listener: null'); const record = registrations.get(key.ref ?? key); if (record) { record.cancelled = true; registrations.delete(key.ref ?? key); } };
  def(LOCATION, 'removeUpdates', `(${LISTENER})V`, remove); def(LOCATION, 'removeUpdates', `(${PENDING})V`, remove);
  // The simulated values or the "location on" switch changed in the page: every registration of a provider that is on hears the new fix (onLocationChanged on its Looper / Executor); the switch itself is
  // onProviderEnabled / onProviderDisabled.
  const deliverChange = (r, previous, now) => {
    const wasEnabled = !!previous?.enabled;
    for (const record of [...registrations.values()]) {
      if (!record.hooks || record.cancelled) continue;
      const target = record.target, roots = [record.key, ...(target ? [target.looper, target.executor].filter(Boolean) : [])];
      if (!!now?.enabled !== wasEnabled) { const hook = now?.enabled ? record.hooks.enabled : record.hooks.disabled; deliverOn(r, target, () => { if (!record.cancelled) hook(); }, roots); }
      if (now?.enabled && (now.version !== previous?.version || !wasEnabled) && hasFix()) {
        deliverOn(r, target, () => { if (record.cancelled) return; record.hooks.location(makeLocation(r, record.provider)); if (record.single) { record.cancelled = true; registrations.delete(record.key.ref ?? record.key); } }, roots);
      }
    }
  };
  platform.locationChanged = (r, previous) => { const now = sim(); if (![...registrations.values()].some(record => record.hooks)) return; platform.queueTask(() => deliverChange(r, previous, now), 0); };   // never runs Java inside the page's message handler: the pump delivers
  // getCurrentLocation: a fresh fix when location is on and one exists, otherwise null (no provider can produce a fix); a cancelled signal suppresses the answer
  const currentLocation = (r, provider, signal, consumer, executor = null) => {
    if (consumer === null || consumer === 0) r.throwJava('Ljava/lang/NullPointerException;', null);
    enforce(r, provider);
    deliverOn(r, executor === null || executor === 0 ? null : { executor }, () => { if (signal !== null && signal !== 0 && call(r, signal, SIGNAL, 'isCanceled', [], 'Z')) return; call(r, consumer, CONSUMER, 'accept', [OBJECT], 'V', [hasFix() && PROVIDERS.includes(provider) ? makeLocation(r, provider) : null]); }, [consumer, signal]);
  };
  def(LOCATION, 'getCurrentLocation', `(${STRING}${SIGNAL}${EXECUTOR}${CONSUMER})V`, (r, _m, [, provider, signal, executor, consumer]) => currentLocation(r, provider_(r, provider), signal, consumer, executor));
  def(LOCATION, 'getCurrentLocation', `(${STRING}${LREQUEST}${SIGNAL}${EXECUTOR}${CONSUMER})V`, (r, _m, [, provider, , signal, executor, consumer]) => currentLocation(r, provider_(r, provider), signal, consumer, executor));
  // GNSS: callbacks register (the status needs ACCESS_FINE_LOCATION) and are never invoked while location is off
  const gnssRegister = (r, callback) => { if (callback === null || callback === 0) r.throwJava('Ljava/lang/NullPointerException;', null); enforce(r, 'gps'); registrations.set(callback.ref ?? callback, { provider: 'gps', key: callback, cancelled: false }); return 1; };
  def(LOCATION, 'registerGnssStatusCallback', `(${GNSS_CB})Z`, (r, _m, [, cb]) => gnssRegister(r, cb)); def(LOCATION, 'registerGnssStatusCallback', `(${GNSS_CB}${HANDLER})Z`, (r, _m, [, cb]) => gnssRegister(r, cb)); def(LOCATION, 'registerGnssStatusCallback', `(${EXECUTOR}${GNSS_CB})Z`, (r, _m, [, , cb]) => gnssRegister(r, cb));
  def(LOCATION, 'unregisterGnssStatusCallback', `(${GNSS_CB})V`, (r, _m, [, cb]) => { if (cb !== null && cb !== 0) registrations.delete(cb.ref ?? cb); });
  def(LOCATION, 'getGnssYearOfHardware', '()I', () => 0); def(LOCATION, 'getGnssHardwareModelName', `()${STRING}`, () => null);

  // ---- SensorManager: a device without sensors ------------------------------------------------------------------------------------------------------------
  const SENSOR = service('sensor', 'Landroid/hardware/SensorManager;');
  def(SENSOR, 'getDefaultSensor', '(I)Landroid/hardware/Sensor;', () => null);
  def(SENSOR, 'getSensorList', '(I)Ljava/util/List;', r => emptyList(r));
  def(SENSOR, 'unregisterListener', '(Landroid/hardware/SensorEventListener;)V', () => {});
  def(SENSOR, 'unregisterListener', '(Landroid/hardware/SensorEventListener;Landroid/hardware/Sensor;)V', () => {});
  // SystemSensorManager.registerListenerImpl: a null listener or sensor is refused with false. This device has no sensors, so no Sensor
  // object can come from it and every registration is refused the same way; no events are ever delivered.
  for (const signature of ['(Landroid/hardware/SensorEventListener;Landroid/hardware/Sensor;I)Z', '(Landroid/hardware/SensorEventListener;Landroid/hardware/Sensor;II)Z',
    '(Landroid/hardware/SensorEventListener;Landroid/hardware/Sensor;ILandroid/os/Handler;)Z', '(Landroid/hardware/SensorEventListener;Landroid/hardware/Sensor;IILandroid/os/Handler;)Z'])
    def(SENSOR, 'registerListener', signature, (r) => { r.record('SENSOR registerListener refused: the virtual device has no sensors'); return 0; });
  def(SENSOR, 'flush', '(Landroid/hardware/SensorEventListener;)Z', () => 0);

  // ---- OrientationEventListener: it listens to the accelerometer, and this device has none (getDefaultSensor(TYPE_ACCELEROMETER) is null) --------------------------------------
  const ORIENTATION = 'Landroid/view/OrientationEventListener;'; type(ORIENTATION, OBJECT, [], { allocatable: true });
  def(ORIENTATION, '<init>', `(${CONTEXT})V`, () => {}); def(ORIENTATION, '<init>', `(${CONTEXT}I)V`, () => {});
  def(ORIENTATION, 'canDetectOrientation', '()Z', () => 0);
  def(ORIENTATION, 'enable', '()V', r => { r.record('SENSOR OrientationEventListener.enable ignored: Cannot detect sensors. Not enabled'); });   // OrientationEventListener.enable logs the same and returns
  def(ORIENTATION, 'disable', '()V', () => {});

  // ---- UiModeManager: follows the Dispositivo panel's dark-theme switch -----------------------------------------------------------------------------------------
  const UI_MODE = service('uimode', 'Landroid/app/UiModeManager;');
  def(UI_MODE, 'getNightMode', '()I', () => device().darkTheme ? 2 : 1); def(UI_MODE, 'getCurrentModeType', '()I', () => 1); def(UI_MODE, 'isNightModeActive', '()Z', () => device().darkTheme ? 1 : 0);

  // ---- biometric / fingerprint: no hardware ------------------------------------------------------------------------------------------------------------------
  const BIOMETRIC = service('biometric', 'Landroid/hardware/biometrics/BiometricManager;');
  def(BIOMETRIC, 'canAuthenticate', '()I', () => 12);   // BIOMETRIC_ERROR_NO_HARDWARE
  def(BIOMETRIC, 'canAuthenticate', '(I)I', (r, _m, [, authenticators]) => (authenticators & 0x8000) ? 11 : 12);   // DEVICE_CREDENTIAL alone: no credential is set up (BIOMETRIC_ERROR_NONE_ENROLLED)
  // BiometricManager.getStrings: with no sensor and no credential the service has no modality to describe, so every label is null (BiometricService returns null for TYPE_NONE)
  const BIOMETRIC_STRINGS = 'Landroid/hardware/biometrics/BiometricManager$Strings;';
  type(BIOMETRIC_STRINGS, 'Ljava/lang/Object;', [], { allocatable: true });
  def(BIOMETRIC, 'getStrings', `(I)${BIOMETRIC_STRINGS}`, (r, _m, [, authenticators]) => { const strings = r.allocate(BIOMETRIC_STRINGS); r.object(strings).authenticators = authenticators; return strings; });
  for (const name of ['getButtonLabel', 'getPromptMessage', 'getSettingName']) def(BIOMETRIC_STRINGS, name, '()Ljava/lang/CharSequence;', () => null);
  const FINGERPRINT = service('fingerprint', 'Landroid/hardware/fingerprint/FingerprintManager;');
  def(FINGERPRINT, 'isHardwareDetected', '()Z', () => 0); def(FINGERPRINT, 'hasEnrolledFingerprints', '()Z', () => 0);

  return { ...registry, getService, serviceNameForClass: classType => byClass.get(classType) ?? null, [GC_ROOTS](visit) { for (const entry of registrations.values()) visit(entry); audioManager.roots(visit); ringtones.roots(visit); } };
}
