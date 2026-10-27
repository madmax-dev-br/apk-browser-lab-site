import { gcRoot } from './heap-gc.js?v=64078a5322f4';
import { createHostRegistry } from './host-contract.js?v=64078a5322f4';
import { GC_ROOTS } from './heap-gc.js?v=64078a5322f4';

// System services for the hardware and device state a browser tab does not have, answered the way a real device with that hardware absent answers (android-13.0.0_r1 service
// contracts): no screen lock (KeyguardManager), no vibrator motor, no sensors, no GPS, no fingerprint/biometric hardware, an audio mixer with default volumes, and an AlarmManager that
// really schedules PendingIntents on the VM clock. Each service exists only through this contract; Context.getSystemService returns it for the service name or its class.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', PENDING = 'Landroid/app/PendingIntent;', CONTEXT = 'Landroid/content/Context;';

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

  // ---- AudioManager: a mixer with Android's default stream maxima and volumes; focus requests are granted ------------------------------------------------------
  const AUDIO = service('audio', 'Landroid/media/AudioManager;');
  const STREAMS = { 0: [5, 4], 1: [7, 5], 2: [7, 5], 3: [15, 7], 4: [7, 6], 5: [7, 5], 6: [15, 7], 8: [15, 7], 9: [15, 7], 10: [15, 7] };   // stream -> [max, default volume]
  const volumes = new Map();
  const stream = (r, id) => { if (!STREAMS[id]) r.throwJava('Ljava/lang/IllegalArgumentException;', `Bad stream type ${id}`); return STREAMS[id]; };
  def(AUDIO, 'getStreamMaxVolume', '(I)I', (r, _m, [, id]) => stream(r, id)[0]);
  def(AUDIO, 'getStreamMinVolume', '(I)I', (r, _m, [, id]) => { stream(r, id); return id === 0 ? 1 : 0; });
  def(AUDIO, 'getStreamVolume', '(I)I', (r, _m, [, id]) => volumes.get(id) ?? stream(r, id)[1]);
  def(AUDIO, 'setStreamVolume', '(III)V', (r, _m, [, id, index]) => { const [max] = stream(r, id); volumes.set(id, Math.max(0, Math.min(max, index))); });
  def(AUDIO, 'getRingerMode', '()I', () => 2); def(AUDIO, 'getMode', '()I', () => 0);
  for (const name of ['isMusicActive', 'isSpeakerphoneOn', 'isMicrophoneMute', 'isBluetoothScoOn', 'isWiredHeadsetOn', 'isBluetoothA2dpOn']) def(AUDIO, name, '()Z', () => 0);
  def(AUDIO, 'isStreamMute', '(I)Z', () => 0);
  def(AUDIO, 'requestAudioFocus', `(Landroid/media/AudioManager$OnAudioFocusChangeListener;II)I`, () => 1);   // AUDIOFOCUS_REQUEST_GRANTED
  def(AUDIO, 'abandonAudioFocus', `(Landroid/media/AudioManager$OnAudioFocusChangeListener;)I`, () => 1);
  def(AUDIO, 'getParameters', `(${STRING})${STRING}`, () => '');

  // ---- AlarmManager: alarms fire as PendingIntent.send() when the VM clock reaches them (RTC types on the wall clock, ELAPSED types on the monotonic one) --------------
  const ALARM = service('alarm', 'Landroid/app/AlarmManager;'), CLOCK_INFO = 'Landroid/app/AlarmManager$AlarmClockInfo;';
  type(CLOCK_INFO, OBJECT, [], { allocatable: true });
  const alarms = new Map(); let nextAlarm = 1;
  const dueIn = (type_, trigger) => Math.max(0, Number(trigger) - ((type_ === 0 || type_ === 1) ? platform.clock.wall() : platform.clock.now()));
  const arm = (r, id) => platform.queueTask(() => fire(r, id), Math.max(1, dueIn(alarms.get(id)?.type, alarms.get(id)?.trigger)), []);
  const fire = (r, id) => {
    const alarm = alarms.get(id); if (!alarm) return;
    if (dueIn(alarm.type, alarm.trigger) > 5) { arm(r, id); return; }   // the VM clock may not have reached it yet
    if (alarm.interval > 0) alarm.trigger = Number(alarm.trigger) + alarm.interval; else alarms.delete(id);
    try { call(r, alarm.operation, PENDING, 'send', [], 'V'); } catch (error) { if (!(error?.value && r.isSubtype(r.typeOf(error.value), 'Landroid/app/PendingIntent$CanceledException;'))) throw error; alarms.delete(id); return; }
    r.record(`ALARM fired ${id}`); if (alarm.interval > 0 && alarms.has(id)) arm(r, id);
  };
  const exactAllowed = r => { const target = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1); return target < 31 || holds(r, 'android.permission.SCHEDULE_EXACT_ALARM') || holds(r, 'android.permission.USE_EXACT_ALARM'); };
  const schedule = (exact, interval = 0) => (r, _m, [, type_, trigger, , operation]) => {
    // the operation is the last PendingIntent argument; signatures differ in their middle parameters
    if (operation === null || operation === undefined) r.throwJava('Ljava/lang/NullPointerException;', 'operation'); if (type_ < 0 || type_ > 3) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid alarm type ${type_}`);
    if (exact && !exactAllowed(r)) r.throwJava('Ljava/lang/SecurityException;', `Caller ${platform.packageName} needs to hold android.permission.SCHEDULE_EXACT_ALARM or android.permission.USE_EXACT_ALARM to set exact alarms.`);
    for (const [id, alarm] of alarms) if (alarm.operation === operation || (alarm.operation?.ref !== undefined && alarm.operation.ref === operation.ref)) alarms.delete(id);   // a new alarm replaces the previous one for the same PendingIntent
    const id = nextAlarm++; alarms.set(id, { type: type_, trigger: Number(trigger), interval, operation }); arm(r, id);
  };
  def(ALARM, 'set', `(IJ${PENDING})V`, (r, m, [self, type_, trigger, operation]) => schedule(false)(r, m, [self, type_, trigger, null, operation]));
  def(ALARM, 'setExact', `(IJ${PENDING})V`, (r, m, [self, type_, trigger, operation]) => schedule(true)(r, m, [self, type_, trigger, null, operation]));
  def(ALARM, 'setAndAllowWhileIdle', `(IJ${PENDING})V`, (r, m, [self, type_, trigger, operation]) => schedule(false)(r, m, [self, type_, trigger, null, operation]));
  def(ALARM, 'setExactAndAllowWhileIdle', `(IJ${PENDING})V`, (r, m, [self, type_, trigger, operation]) => schedule(true)(r, m, [self, type_, trigger, null, operation]));
  def(ALARM, 'setWindow', `(IJJ${PENDING})V`, (r, m, [self, type_, trigger, , operation]) => schedule(false)(r, m, [self, type_, trigger, null, operation]));
  def(ALARM, 'setRepeating', `(IJJ${PENDING})V`, (r, m, [self, type_, trigger, interval, operation]) => schedule(false, Math.max(Number(interval), 60000))(r, m, [self, type_, trigger, null, operation]));   // the platform raises intervals below 60 s
  def(ALARM, 'setInexactRepeating', `(IJJ${PENDING})V`, (r, m, [self, type_, trigger, interval, operation]) => schedule(false, Math.max(Number(interval), 60000))(r, m, [self, type_, trigger, null, operation]));
  def(ALARM, 'setAlarmClock', `(${CLOCK_INFO}${PENDING})V`, (r, m, [self, info, operation]) => schedule(true)(r, m, [self, 0, r.object(info).trigger, null, operation]));
  def(CLOCK_INFO, '<init>', `(J${PENDING})V`, (r, _m, [self, trigger, show]) => Object.assign(r.object(self), { trigger: Number(trigger), show }));
  def(CLOCK_INFO, 'getTriggerTime', '()J', (r, _m, [self]) => BigInt(r.object(self).trigger)); def(CLOCK_INFO, 'getShowIntent', `()${PENDING}`, (r, _m, [self]) => r.object(self).show);
  def(ALARM, 'cancel', `(${PENDING})V`, (r, _m, [, operation]) => { for (const [id, alarm] of alarms) if (alarm.operation?.ref === operation?.ref) alarms.delete(id); });
  def(ALARM, 'getNextAlarmClock', `()${CLOCK_INFO}`, () => null);
  def(ALARM, 'canScheduleExactAlarms', '()Z', r => exactAllowed(r) ? 1 : 0);
  for (const [name, value] of Object.entries({ RTC_WAKEUP: 0, RTC: 1, ELAPSED_REALTIME_WAKEUP: 2, ELAPSED_REALTIME: 3 })) registry.staticField(ALARM, name, 'I', () => value);
  for (const [name, value] of Object.entries({ INTERVAL_FIFTEEN_MINUTES: 900000n, INTERVAL_HALF_HOUR: 1800000n, INTERVAL_HOUR: 3600000n, INTERVAL_HALF_DAY: 43200000n, INTERVAL_DAY: 86400000n })) registry.staticField(ALARM, name, 'J', () => value);

  // ---- LocationManager: no GPS/network provider, location services off ------------------------------------------------------------------------------------
  const LOCATION = service('location', 'Landroid/location/LocationManager;');
  def(LOCATION, 'isLocationEnabled', '()Z', () => 0); def(LOCATION, 'isProviderEnabled', `(${STRING})Z`, () => 0);
  def(LOCATION, 'getAllProviders', '()Ljava/util/List;', r => { const list = emptyList(r); call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', ['passive']); return list; });
  def(LOCATION, 'getProviders', '(Z)Ljava/util/List;', r => emptyList(r));
  def(LOCATION, 'getLastKnownLocation', `(${STRING})Landroid/location/Location;`, (r, _m, [, provider]) => {
    if (provider === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid provider: null');
    if (!holds(r, 'android.permission.ACCESS_FINE_LOCATION') && !holds(r, 'android.permission.ACCESS_COARSE_LOCATION')) r.throwJava('Ljava/lang/SecurityException;', `uid ${platform.virtualProcess?.uid ?? 10000} does not have android.permission.ACCESS_COARSE_LOCATION or android.permission.ACCESS_FINE_LOCATION.`);
    return null;
  });
  def(LOCATION, 'removeUpdates', '(Landroid/location/LocationListener;)V', () => {});

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
  const FINGERPRINT = service('fingerprint', 'Landroid/hardware/fingerprint/FingerprintManager;');
  def(FINGERPRINT, 'isHardwareDetected', '()Z', () => 0); def(FINGERPRINT, 'hasEnrolledFingerprints', '()Z', () => 0);

  return { ...registry, getService, serviceNameForClass: classType => byClass.get(classType) ?? null, [GC_ROOTS](visit) { for (const alarm of alarms.values()) visit(alarm); } };
}
