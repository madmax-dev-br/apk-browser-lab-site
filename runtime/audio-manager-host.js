import { mixerOf } from './audio-native.js?v=a64e78a38c60';
import { APKError } from './apk-error.js?v=a64e78a38c60';

// android.media.AudioManager on the virtual device (android-13.0.0_r1 AudioService / MediaFocusControl contracts), installed on the host type `AudioManagerImpl`:
//   * stream volumes with Android's default maxima and indexes, adjust*() with mute/unmute/toggle, and the ringer mode with the Do Not Disturb rule: toggling silent mode changes the
//     zen state, which an app targeting N or later may only do with Notification Policy access (SecurityException "Not allowed to change Do Not Disturb state"), and the device has none;
//   * the audio mode, speakerphone and microphone-mute switches (they need MODIFY_AUDIO_SETTINGS; without it the call is a logged no-op like AudioService.checkAudioSettingsPermission);
//   * the audio focus stack: a new request takes the top and the previous holder is told AUDIOFOCUS_LOSS / LOSS_TRANSIENT / LOSS_TRANSIENT_CAN_DUCK according to the gain asked for;
//     abandoning gives the focus back to the holder underneath (AUDIOFOCUS_GAIN); both the legacy listener form and AudioFocusRequest are keyed by the listener (else the request);
//   * session ids drawn from the same counter as AudioTrack, properties of the output (48 kHz, 192 frames), the built-in devices of AudioManagerDevices with device callbacks, the
//     communication device, sound-effect calls (the device has no sound-effect assets: no-ops) and empty playback / recording configuration lists;
//   * the output capabilities of the virtual device: no offload-capable, direct or HW A/V sync output (consistent with AudioTrack), no call screening, no vibrator; surround settings readable through the service only with WRITE_SETTINGS;
//   * the Spatializer of a device without a spatializer effect (ro.audio.spatializer_enabled false: SpatializerHelper stays STATE_NOT_SUPPORTED).
// Focus and device callbacks are delivered as host events on the main thread (the Handler an AudioFocusRequest names is not used for delivery); listeners registered with an Executor
// (communication device, audio mode) run on it, with CallbackUtil.LazyListenerManager's rules (identity, IllegalArgumentException for a second add or an unknown remove).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', LISTENER = 'Landroid/media/AudioManager$OnAudioFocusChangeListener;', REQUEST = 'Landroid/media/AudioFocusRequest;';
const DEVICE = 'Landroid/media/AudioDeviceInfo;', DEVICES = 'Landroid/media/AudioManagerDevices;', CALLBACK = 'Landroid/media/AudioDeviceCallback;', HANDLER = 'Landroid/os/Handler;';
const COMM_LISTENER = 'Landroid/media/AudioManager$OnCommunicationDeviceChangedListener;', MODE_LISTENER = 'Landroid/media/AudioManager$OnModeChangedListener;', EXECUTOR = 'Ljava/util/concurrent/Executor;';
const RUNNABLE = 'Ljava/lang/Runnable;', DELIVERY = 'Lapkweb/bridge/LocationDelivery;', ATTRIBUTES = 'Landroid/media/AudioAttributes;', FORMAT = 'Landroid/media/AudioFormat;', LIST = 'Ljava/util/List;';
const STREAMS = { 0: [5, 4], 1: [7, 5], 2: [7, 5], 3: [15, 7], 4: [7, 6], 5: [7, 5], 6: [15, 7], 8: [15, 7], 9: [15, 7], 10: [15, 7] };   // stream -> [max, default index]
const RING_ALIASED = new Set([1, 2, 5]);   // STREAM_SYSTEM, STREAM_RING and STREAM_NOTIFICATION follow the ringer
const NORMAL = 2, VIBRATE = 1, SILENT = 0;
const FOCUS = { GAIN: 1, GAIN_TRANSIENT: 2, GAIN_TRANSIENT_MAY_DUCK: 3, GAIN_TRANSIENT_EXCLUSIVE: 4 };
const GRANTED = 1;
const PROPERTIES = {
  'android.media.property.OUTPUT_SAMPLE_RATE': '48000', 'android.media.property.OUTPUT_FRAMES_PER_BUFFER': '192',
  'android.media.property.SUPPORT_MIC_NEAR_ULTRASOUND': 'false', 'android.media.property.SUPPORT_SPEAKER_NEAR_ULTRASOUND': 'false', 'android.media.property.SUPPORT_AUDIO_SOURCE_UNPROCESSED': 'true',
};

/** Installs AudioManager on `registry` as service 'audio'; returns the GC roots visitor for the refs the manager keeps (focus holders, callbacks). */
export function installAudioManager({ platform, def, type, staticField, service, call, holds, emptyList }) {
  const MANAGER = 'Landroid/media/AudioManager;', AUDIO = service('audio', MANAGER);
  const state = { volumes: new Map(), muted: new Set(), ringer: NORMAL, mode: 0, speaker: false, micMute: false, communication: null, sound: false };
  const focus = [];                 // bottom .. top: { key, listener, request, gain, pauseOnDuck, delayed }
  const deviceCallbacks = [], communicationListeners = [], playbackCallbacks = [], recordingCallbacks = [];
  const record = (r, line) => r.record(`AUDIO ${line}`);
  const sdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1);
  const isNull = v => v === null || v === undefined || v === 0;
  const npe = r => r.throwJava('Ljava/lang/NullPointerException;', null);   // Objects.requireNonNull
  /** A dispatch from the audio service: after the call returns (a host event, like the oneway binder callback), Executor.execute(Runnable) with a platform closure (the delivery Runnable of
   *  src/hardware-services-host.js) unless the listener was removed meanwhile (`alive`); `roots`: the Java values the closure holds. */
  const runOn = (r, executor, task, roots, alive = () => true) => platform.queueTask(() => { if (!alive()) return; const runnable = r.allocate(DELIVERY); Object.assign(r.object(runnable), { task, held: roots }); call(r, executor, EXECUTOR, 'execute', [RUNNABLE], 'V', [runnable]); }, 0, roots);
  /** CallbackUtil.addListener / removeListener (android-13.0.0_r1): listeners by identity; the dispatcher stub registers with the service when the first listener comes and unregisters after the last. */
  const addListener = (r, list, executor, listener, methodName, register) => {
    if (isNull(executor) || isNull(listener)) npe(r);
    if (list.some(held => held.listener.ref === listener.ref)) r.throwJava('Ljava/lang/IllegalArgumentException;', `attempt to call ${methodName}on a previously registered listener`);
    if (list.length === 0) register?.(r);
    list.push({ executor, listener });
  };
  const removeListener = (r, list, listener, methodName, unregister) => {
    if (isNull(listener)) npe(r);
    const at = list.findIndex(held => held.listener.ref === listener.ref);
    if (at < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `attempt to call ${methodName}on an unregistered listener`);
    list.splice(at, 1);
    if (list.length === 0) unregister?.(r);
  };

  const stream = (r, id) => { if (!STREAMS[id]) r.throwJava('Ljava/lang/IllegalArgumentException;', `Bad stream type ${id}`); return STREAMS[id]; };
  const minIndex = id => id === 0 ? 1 : 0;
  const index = (r, id) => {
    const [, def_] = stream(r, id);
    if (RING_ALIASED.has(id) && state.ringer !== NORMAL) return 0;           // silent / vibrate (no vibrator) reads 0, like AudioService.getStreamVolume under a muting ringer
    return state.volumes.get(id) ?? def_;
  };
  const policyAccess = () => platform.notificationPolicyAccess === true;
  /** AudioService.wouldToggleZenMode: silent mode is the zen-visible state, entering or leaving it changes Do Not Disturb. */
  const requireDndAccess = (r, newRinger) => {
    const toggles = (newRinger === SILENT && state.ringer !== SILENT) || (newRinger !== SILENT && state.ringer === SILENT);
    if (toggles && sdk() >= 24 && !policyAccess()) r.throwJava('Ljava/lang/SecurityException;', 'Not allowed to change Do Not Disturb state');
  };
  const settingsAllowed = (r, what) => { if (holds(r, 'android.permission.MODIFY_AUDIO_SETTINGS')) return true; record(r, `${what} ignored: MODIFY_AUDIO_SETTINGS not granted`); return false; };
  const setIndex = (r, id, wanted) => {
    const [max] = stream(r, id), clamped = Math.max(minIndex(id), Math.min(max, wanted));
    if (RING_ALIASED.has(id) && id !== 1) {   // ring / notification: reaching 0 with no vibrator mutes into silent mode, leaving 0 from silent restores normal
      const newRinger = clamped === 0 ? SILENT : NORMAL;
      if (clamped === 0 && state.ringer !== SILENT || clamped > 0 && state.ringer === SILENT) { requireDndAccess(r, newRinger); state.ringer = newRinger; }
    }
    if (clamped > 0) state.muted.delete(id);
    if (clamped > 0 || !RING_ALIASED.has(id)) state.volumes.set(id, clamped); else if (!state.volumes.has(id)) state.volumes.set(id, STREAMS[id][1]);
  };

  def(AUDIO, 'getStreamMaxVolume', '(I)I', (r, _m, [, id]) => stream(r, id)[0]);
  def(AUDIO, 'getStreamMinVolume', '(I)I', (r, _m, [, id]) => { stream(r, id); return minIndex(id); });
  def(AUDIO, 'getStreamVolume', '(I)I', (r, _m, [, id]) => index(r, id));
  def(AUDIO, 'setStreamVolume', '(III)V', (r, _m, [, id, wanted]) => { setIndex(r, id, wanted); });
  def(AUDIO, 'isStreamMute', '(I)Z', (r, _m, [, id]) => { stream(r, id); return state.muted.has(id) || (RING_ALIASED.has(id) && state.ringer === SILENT) ? 1 : 0; });
  def(AUDIO, 'isVolumeFixed', '()Z', () => 0);
  const adjust = (r, id, direction) => {
    stream(r, id);
    if (direction === 100) { state.muted.delete(id); return; }                                   // ADJUST_UNMUTE
    if (direction === -100 || (direction === 101 && !state.muted.has(id))) {                      // ADJUST_MUTE, ADJUST_TOGGLE_MUTE
      if (RING_ALIASED.has(id) && id !== 1) { requireDndAccess(r, SILENT); state.ringer = SILENT; }
      state.muted.add(id); return;
    }
    if (direction === 101) { state.muted.delete(id); if (RING_ALIASED.has(id) && id !== 1 && state.ringer === SILENT) { requireDndAccess(r, NORMAL); state.ringer = NORMAL; } return; }
    if (direction !== 0) setIndex(r, id, (state.volumes.get(id) ?? STREAMS[id][1]) + (direction > 0 ? 1 : -1));
    else if (state.muted.has(id)) state.muted.delete(id);
  };
  const musicActive = r => { for (const t of mixerOf(r).tracks.values()) if (t.state === 'playing' || t.state === 'draining') return true; return false; };
  def(AUDIO, 'adjustStreamVolume', '(III)V', (r, _m, [, id, direction]) => { adjust(r, id, direction); });
  def(AUDIO, 'adjustVolume', '(II)V', (r, _m, [, direction]) => { adjust(r, musicActive(r) ? 3 : 2, direction); });
  def(AUDIO, 'adjustSuggestedStreamVolume', '(III)V', (r, _m, [, direction, suggested]) => { adjust(r, STREAMS[suggested] ? suggested : musicActive(r) ? 3 : 2, direction); });

  // ---- ringer, mode, speakerphone, microphone ------------------------------------------------------------------------------------------------------
  def(AUDIO, 'getRingerMode', '()I', () => state.ringer);
  def(AUDIO, 'isValidRingerMode', '(I)Z', (r, _m, [, mode]) => mode >= 0 && mode <= 2 ? 1 : 0);
  def(AUDIO, 'setRingerMode', '(I)V', (r, _m, [, mode]) => {
    if (mode < 0 || mode > 2) return;                                                          // AudioManager ignores an invalid ringer mode
    const effective = mode === VIBRATE ? SILENT : mode;                                         // no vibrator: vibrate behaves as silent
    requireDndAccess(r, effective); state.ringer = effective; record(r, `ringer mode ${effective}`);
  });
  def(AUDIO, 'getMode', '()I', () => state.mode);
  // AudioService.setMode: MODIFY_AUDIO_SETTINGS, a mode in [MODE_CURRENT, NUM_MODES), MODE_CALL_SCREENING only where the HAL supports it (this device does not), MODE_IN_CALL / MODE_CALL_REDIRECT /
  // MODE_COMMUNICATION_REDIRECT only with MODIFY_PHONE_STATE; a change is dispatched to the OnModeChangedListeners.
  const MODE_NAMES = ['MODE_NORMAL', 'MODE_RINGTONE', 'MODE_IN_CALL', 'MODE_IN_COMMUNICATION', 'MODE_CALL_SCREENING', 'MODE_CALL_REDIRECT', 'MODE_COMMUNICATION_REDIRECT'];
  const modeListeners = [];
  def(AUDIO, 'setMode', '(I)V', (r, _m, [, wanted]) => {
    if (!settingsAllowed(r, 'setMode')) return;
    if (wanted < -1 || wanted >= MODE_NAMES.length) { record(r, `setMode() invalid mode: ${wanted}`); return; }
    const mode = wanted === -1 ? state.mode : wanted;
    if (mode === 4) { record(r, 'setMode(MODE_CALL_SCREENING) not permitted when call screening is not supported'); return; }
    if ((mode === 2 || mode === 5 || mode === 6) && !holds(r, 'android.permission.MODIFY_PHONE_STATE')) { record(r, `setMode(${MODE_NAMES[mode]}) ignored: MODIFY_PHONE_STATE not granted`); return; }
    if (state.mode === mode) return;
    state.mode = mode;
    for (const entry of modeListeners) runOn(r, entry.executor, () => call(r, entry.listener, MODE_LISTENER, 'onModeChanged', ['I'], 'V', [mode]), [entry.executor, entry.listener], () => modeListeners.includes(entry));
  });
  def(AUDIO, 'isCallScreeningModeSupported', '()Z', () => 0);
  def(AUDIO, 'addOnModeChangedListener', `(${EXECUTOR}${MODE_LISTENER})V`, (r, _m, [, executor, listener]) => { addListener(r, modeListeners, executor, listener, 'addOnModeChangedListener'); });
  def(AUDIO, 'removeOnModeChangedListener', `(${MODE_LISTENER})V`, (r, _m, [, listener]) => { removeListener(r, modeListeners, listener, 'removeOnModeChangedListener'); });
  def(AUDIO, 'isSpeakerphoneOn', '()Z', () => state.speaker ? 1 : 0);
  def(AUDIO, 'setSpeakerphoneOn', '(Z)V', (r, _m, [, on]) => { if (settingsAllowed(r, 'setSpeakerphoneOn')) state.speaker = !!on; });
  def(AUDIO, 'isMicrophoneMute', '()Z', () => state.micMute ? 1 : 0);
  def(AUDIO, 'setMicrophoneMute', '(Z)V', (r, _m, [, on]) => { if (settingsAllowed(r, 'setMicrophoneMute')) state.micMute = !!on; });
  def(AUDIO, 'isMusicActive', '()Z', r => musicActive(r) ? 1 : 0);
  for (const name of ['isBluetoothScoOn', 'isWiredHeadsetOn', 'isBluetoothA2dpOn', 'isBluetoothScoAvailableOffCall']) def(AUDIO, name, '()Z', () => 0);
  for (const name of ['startBluetoothSco', 'stopBluetoothSco']) def(AUDIO, name, '()V', () => {});
  def(AUDIO, 'setBluetoothScoOn', '(Z)V', () => {});
  def(AUDIO, 'getParameters', `(${STRING})${STRING}`, () => '');
  def(AUDIO, 'setParameters', `(${STRING})V`, () => {});
  def(AUDIO, 'getProperty', `(${STRING})${STRING}`, (r, _m, [, key]) => { if (isNull(key)) r.throwJava('Ljava/lang/NullPointerException;', 'key'); return PROPERTIES[r.stringCharacters(key)] ?? null; });
  def(AUDIO, 'generateAudioSessionId', '()I', r => mixerOf(r).sessionId());
  def(MANAGER, 'isHapticPlaybackSupported', '()Z', () => 0, { static: true });

  // ---- sound effects: the device ships no sound-effect assets ---------------------------------------------------------------------------------------
  def(AUDIO, 'playSoundEffect', '(I)V', (r, _m, [, effect]) => { if (effect < 0 || effect >= 10 && effect !== 100) return; });
  def(AUDIO, 'playSoundEffect', '(IF)V', () => {});
  def(AUDIO, 'loadSoundEffects', '()V', () => {}); def(AUDIO, 'unloadSoundEffects', '()V', () => {});

  // ---- audio focus ---------------------------------------------------------------------------------------------------------------------------------
  const lossFor = (gain, pauseOnDuck) => gain === FOCUS.GAIN ? -1 : gain === FOCUS.GAIN_TRANSIENT_MAY_DUCK ? (pauseOnDuck ? -2 : -3) : -2;
  const notify = (r, entry, change) => {
    if (isNull(entry.listener)) return;
    record(r, `focus change ${change} for ${entry.key.ref ?? '?'}`);
    platform.queueTask(() => call(r, entry.listener, LISTENER, 'onAudioFocusChange', ['I'], 'V', [change]), 0, [entry.listener]);
  };
  const sameKey = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && a.ref === b.ref);
  const grant = (r, entry) => {
    const at = focus.findIndex(held => sameKey(held.key, entry.key)); if (at >= 0) focus.splice(at, 1);
    const top = focus.at(-1);
    if (top) {
      const change = lossFor(entry.gain, top.pauseOnDuck);
      notify(r, top, change);
      if (change === -1) focus.pop();                                                           // a permanent loss ends that holder's claim
    }
    focus.push(entry); return GRANTED;
  };
  const release = (r, key) => {
    const at = focus.findIndex(held => sameKey(held.key, key)); if (at < 0) return;
    const wasTop = at === focus.length - 1; focus.splice(at, 1);
    if (wasTop && focus.length) notify(r, focus.at(-1), 1);                                     // AUDIOFOCUS_GAIN for the holder underneath
  };
  def(AUDIO, 'requestAudioFocus', `(${LISTENER}II)I`, (r, _m, [, listener, streamType, hint]) => {
    if (isNull(listener)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal null AudioFocusChangeListener');
    if (hint < 1 || hint > 4) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid duration hint');
    return grant(r, { key: listener, listener, request: null, gain: hint, pauseOnDuck: false });
  });
  def(AUDIO, 'abandonAudioFocus', `(${LISTENER})I`, (r, _m, [, listener]) => { if (!isNull(listener)) release(r, listener); return GRANTED; });
  def(AUDIO, 'requestAudioFocus', `(${REQUEST})I`, (r, _m, [, request]) => {
    if (isNull(request)) r.throwJava('Ljava/lang/NullPointerException;', 'Illegal null AudioFocusRequest');
    const listener = call(r, request, REQUEST, 'getOnAudioFocusChangeListener', [], LISTENER), gain = call(r, request, REQUEST, 'getFocusGain', [], 'I');
    return grant(r, { key: isNull(listener) ? request : listener, listener, request, gain, pauseOnDuck: !!call(r, request, REQUEST, 'willPauseWhenDucked', [], 'Z') });
  });
  def(AUDIO, 'abandonAudioFocusRequest', `(${REQUEST})I`, (r, _m, [, request]) => {
    if (isNull(request)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal null AudioFocusRequest');
    const listener = call(r, request, REQUEST, 'getOnAudioFocusChangeListener', [], LISTENER); release(r, isNull(listener) ? request : listener); return GRANTED;
  });

  // ---- devices ---------------------------------------------------------------------------------------------------------------------------------------
  const sink = r => [r.dispatch({ owner: DEVICES, name: 'builtInSpeaker', parameters: [], result: DEVICE, signature: `()${DEVICE}` }, [], 'static'), r.dispatch({ owner: DEVICES, name: 'builtInEarpiece', parameters: [], result: DEVICE, signature: `()${DEVICE}` }, [], 'static')];
  const source = r => [r.dispatch({ owner: DEVICES, name: 'builtInMic', parameters: [], result: DEVICE, signature: `()${DEVICE}` }, [], 'static')];
  const deviceArray = (r, list) => { const array = r.newArray(`[${DEVICE}`, list.length); r.array(array).elements = list; return array; };
  const devices = (r, flags) => [...(flags & 2 ? sink(r) : []), ...(flags & 1 ? source(r) : [])];
  def(AUDIO, 'getDevices', `(I)[${DEVICE}`, (r, _m, [, flags]) => deviceArray(r, devices(r, flags)));
  def(AUDIO, 'registerAudioDeviceCallback', `(${CALLBACK}${HANDLER})V`, (r, _m, [, callback]) => {
    if (isNull(callback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal null AudioDeviceCallback');
    if (deviceCallbacks.some(held => sameKey(held, callback))) return;
    deviceCallbacks.push(callback);
    platform.queueTask(() => call(r, callback, CALLBACK, 'onAudioDevicesAdded', [`[${DEVICE}`], 'V', [deviceArray(r, devices(r, 3))]), 0, [callback]);   // AudioManager reports the present devices at registration
  });
  def(AUDIO, 'unregisterAudioDeviceCallback', `(${CALLBACK})V`, (r, _m, [, callback]) => { const at = deviceCallbacks.findIndex(held => sameKey(held, callback)); if (at >= 0) deviceCallbacks.splice(at, 1); });
  const communicationDevices = r => sink(r);
  def(AUDIO, 'getAvailableCommunicationDevices', '()Ljava/util/List;', r => {
    const list = emptyList(r); for (const device of communicationDevices(r)) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [device]); return list;
  });
  def(AUDIO, 'getCommunicationDevice', `()${DEVICE}`, r => state.communication ?? communicationDevices(r)[1]);   // a phone's default communication route is the earpiece
  def(AUDIO, 'setCommunicationDevice', `(${DEVICE})Z`, (r, _m, [, device]) => {
    if (isNull(device)) r.throwJava('Ljava/lang/NullPointerException;', 'device must not be null');
    const wanted = call(r, device, DEVICE, 'getType', [], 'I');
    const match = communicationDevices(r).find(candidate => call(r, candidate, DEVICE, 'getType', [], 'I') === wanted);
    if (!match) r.throwJava('Ljava/lang/IllegalArgumentException;', `device type ${wanted} is not a valid communication device`);
    const changed = state.communication === null || call(r, state.communication, DEVICE, 'getType', [], 'I') !== wanted;
    state.communication = match;
    if (changed) for (const entry of communicationListeners) runOn(r, entry.executor, () => call(r, entry.listener, COMM_LISTENER, 'onCommunicationDeviceChanged', [DEVICE], 'V', [match]), [entry.executor, entry.listener, match], () => communicationListeners.includes(entry));
    return 1;
  });
  def(AUDIO, 'clearCommunicationDevice', '()V', () => { state.communication = null; });
  // AudioManager.getAudioDevicesForAttributes (public since API 33): the output devices the audio policy routes these attributes to, as the AudioDeviceInfo of getDevices(OUTPUTS)
  // in an unmodifiable list. android-13.0.0_r1 wraps Objects.requireNonNull and the service call in one try: null attributes (or a failed call) log "No audio devices available for
  // specified attributes." and answer Collections.emptyList(). Routing of the default policy engine on a device with only the built-in speaker and earpiece: voice communication
  // (USAGE_VOICE_COMMUNICATION) follows the communication route (the chosen communication device, else the speaker with speakerphone on, else the earpiece), and so does call
  // signalling (USAGE_VOICE_COMMUNICATION_SIGNALLING, the DTMF strategy) while the mode is a call; every other usage plays on the speaker.
  const COLLECTIONS = 'Ljava/util/Collections;';
  const communicationRoute = r => state.communication ?? communicationDevices(r)[state.speaker ? 0 : 1];
  def(AUDIO, 'getAudioDevicesForAttributes', `(${ATTRIBUTES})${LIST}`, (r, _m, [, attributes]) => {
    if (isNull(attributes)) {
      r.dispatch({ owner: 'Landroid/util/Log;', name: 'i', parameters: [STRING, STRING], result: 'I', signature: `(${STRING}${STRING})I` }, [r.javaString('AudioManager'), r.javaString('No audio devices available for specified attributes.')], 'static');
      return r.dispatch({ owner: COLLECTIONS, name: 'emptyList', parameters: [], result: LIST, signature: `()${LIST}` }, [], 'static');
    }
    const usage = call(r, attributes, ATTRIBUTES, 'getUsage', [], 'I'), inCall = state.mode === 2 || state.mode === 3;
    const route = usage === 2 || (usage === 3 && inCall) ? communicationRoute(r) : sink(r)[0];
    const list = emptyList(r); call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [route]);
    return r.dispatch({ owner: COLLECTIONS, name: 'unmodifiableList', parameters: [LIST], result: LIST, signature: `(${LIST})${LIST}` }, [list], 'static');
  });
  def(AUDIO, 'addOnCommunicationDeviceChangedListener', `(${EXECUTOR}${COMM_LISTENER})V`, (r, _m, [, executor, listener]) => { addListener(r, communicationListeners, executor, listener, 'addOnCommunicationDeviceChangedListener'); });
  def(AUDIO, 'removeOnCommunicationDeviceChangedListener', `(${COMM_LISTENER})V`, (r, _m, [, listener]) => { removeListener(r, communicationListeners, listener, 'removeOnCommunicationDeviceChangedListener'); });

  // ---- playback / recording configurations: no other app is playing or recording on the virtual device -----------------------------------------------------
  def(AUDIO, 'getActivePlaybackConfigurations', '()Ljava/util/List;', r => emptyList(r));
  def(AUDIO, 'getActiveRecordingConfigurations', '()Ljava/util/List;', r => emptyList(r));
  const callbackPair = (register, unregister, list, type) => {
    def(AUDIO, register, `(${type}${HANDLER})V`, (r, _m, [, callback]) => { if (isNull(callback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal null callback'); if (!list.some(held => sameKey(held, callback))) list.push(callback); });
    def(AUDIO, unregister, `(${type})V`, (r, _m, [, callback]) => { const at = list.findIndex(held => sameKey(held, callback)); if (at >= 0) list.splice(at, 1); });
  };
  callbackPair('registerAudioPlaybackCallback', 'unregisterAudioPlaybackCallback', playbackCallbacks, 'Landroid/media/AudioManager$AudioPlaybackCallback;');
  callbackPair('registerAudioRecordingCallback', 'unregisterAudioRecordingCallback', recordingCallbacks, 'Landroid/media/AudioManager$AudioRecordingCallback;');


  // ---- output capabilities: the mixer of the virtual device has no offload-capable, direct (bitstream) or HW A/V sync output, like AudioTrack reports (isDirectPlaybackSupported,
  //      isOffloadedPlaybackSupported false; an offload Builder is refused). AudioManager.java android-13.0.0_r1 argument checks; AudioSystem answers PLAYBACK_OFFLOAD_NOT_SUPPORTED (0),
  //      DIRECT_PLAYBACK_NOT_SUPPORTED (0), no direct AudioProfile and AUDIO_HW_SYNC_INVALID.
  const STATIC = { static: true };
  const offloadArgs = (r, format, attributes) => { if (isNull(format)) r.throwJava('Ljava/lang/NullPointerException;', 'Illegal null AudioFormat'); if (isNull(attributes)) r.throwJava('Ljava/lang/NullPointerException;', 'Illegal null AudioAttributes'); };
  def(MANAGER, 'isOffloadedPlaybackSupported', `(${FORMAT}${ATTRIBUTES})Z`, (r, _m, [format, attributes]) => { offloadArgs(r, format, attributes); return 0; }, STATIC);
  def(MANAGER, 'getPlaybackOffloadSupport', `(${FORMAT}${ATTRIBUTES})I`, (r, _m, [format, attributes]) => { offloadArgs(r, format, attributes); return 0; }, STATIC);
  def(MANAGER, 'getDirectPlaybackSupport', `(${FORMAT}${ATTRIBUTES})I`, (r, _m, [format, attributes]) => { if (isNull(format) || isNull(attributes)) npe(r); return 0; }, STATIC);
  def(AUDIO, 'getDirectProfilesForAttributes', `(${ATTRIBUTES})${LIST}`, (r, _m, [, attributes]) => { if (isNull(attributes)) npe(r); return emptyList(r); });
  def(AUDIO, 'getAudioHwSyncForSession', '(I)I', r => r.throwJava('Ljava/lang/UnsupportedOperationException;', 'HW A/V synchronization is not supported.'));

  // ---- playback capture policy of the app's uid (AudioService / PlaybackActivityMonitor): ALLOW_CAPTURE_BY_ALL until the app sets another; AudioAttributes.capturePolicyToFlags validates it
  let capturePolicy = 1;
  def(AUDIO, 'getAllowedCapturePolicy', '()I', () => capturePolicy);
  def(AUDIO, 'setAllowedCapturePolicy', '(I)V', (r, _m, [, policy]) => {
    r.dispatch({ owner: ATTRIBUTES, name: 'capturePolicyToFlags', parameters: ['I', 'I'], result: 'I', signature: '(II)I' }, [policy, 0], 'static');   // IllegalArgumentException for an unknown policy
    capturePolicy = policy;
  });

  // ---- settings the audio service reads: encoded surround (Settings.Global, readable through AudioService only with WRITE_SETTINGS), the ramping ringer (Settings.System, default off)
  const RESOLVER = 'Landroid/content/ContentResolver;', GLOBAL = 'Landroid/provider/Settings$Global;';
  const resolver = r => call(r, platform.application, 'Landroid/content/Context;', 'getContentResolver', [], RESOLVER);
  const intSetting = (r, owner, name, fallback) => r.dispatch({ owner, name: 'getInt', parameters: [RESOLVER, STRING, 'I'], result: 'I', signature: `(${RESOLVER}${STRING}I)I` }, [resolver(r), r.javaString(name), fallback], 'static');
  const stringSetting = (r, owner, name) => r.dispatch({ owner, name: 'getString', parameters: [RESOLVER, STRING], result: STRING, signature: `(${RESOLVER}${STRING})${STRING}` }, [resolver(r), r.javaString(name)], 'static');
  const needWriteSettings = r => { if (!holds(r, 'android.permission.WRITE_SETTINGS')) r.throwJava('Ljava/lang/SecurityException;', 'Missing WRITE_SETTINGS permission'); };
  const notModelled = what => { throw new APKError(`AudioManager.${what}: writing the device's global surround settings as the audio service is not modelled`, { kind: 'unsupported-audio' }); };
  const isSurroundFormat = (r, format) => r.array(r.readStatic({ owner: FORMAT, name: 'SURROUND_SOUND_ENCODING', type: '[I' })).cells.includes(format);
  def(AUDIO, 'getEncodedSurroundMode', '()I', r => {
    needWriteSettings(r);
    const value = intSetting(r, GLOBAL, 'encoded_surround_output', 0);           // ENCODED_SURROUND_OUTPUT_AUTO
    if (sdk() <= 31 && value > 3) return -1;                                      // AudioService.toEncodedSurroundOutputMode: above ENCODED_SURROUND_SC_MAX is UNKNOWN up to S
    return value >= 0 && value <= 3 ? value : -1;
  });
  def(AUDIO, 'setEncodedSurroundMode', '(I)Z', r => { needWriteSettings(r); notModelled('setEncodedSurroundMode'); });
  def(AUDIO, 'isSurroundFormatEnabled', '(I)Z', (r, _m, [, format]) => {
    if (!isSurroundFormat(r, format)) { record(r, 'isSurroundFormatEnabled: audioFormat to enable is not a surround format.'); return 0; }
    needWriteSettings(r);
    const text = stringSetting(r, GLOBAL, 'encoded_surround_output_enabled_formats'); if (isNull(text)) return 0;
    const parts = r.stringCharacters(text).split(','); if (parts.some(part => !/^[+-]?\d+$/.test(part))) return 0;   // misformatted: no enabled format (NumberFormatException is logged)
    return parts.map(Number).includes(format) ? 1 : 0;
  });
  def(AUDIO, 'setSurroundFormatEnabled', '(IZ)Z', (r, _m, [, format]) => { if (!isSurroundFormat(r, format)) return 0; needWriteSettings(r); notModelled('setSurroundFormatEnabled'); });
  def(AUDIO, 'isRampingRingerEnabled', '()Z', r => intSetting(r, 'Landroid/provider/Settings$System;', 'apply_ramping_ringer', 0) !== 0 ? 1 : 0);

  // ---- deprecated calls (AudioManager.java android-13.0.0_r1): routing is gone, solo and the wired / A2DP switches do nothing, setStreamMute is adjustStreamVolume; no vibrator: VIBRATE_SETTING_OFF
  def(AUDIO, 'getRouting', '(I)I', () => -1);
  def(AUDIO, 'setRouting', '(III)V', () => {});
  def(AUDIO, 'setStreamSolo', '(IZ)V', r => { record(r, 'setStreamSolo has been deprecated. Do not use.'); });
  def(AUDIO, 'setWiredHeadsetOn', '(Z)V', () => {}); def(AUDIO, 'setBluetoothA2dpOn', '(Z)V', () => {});
  def(AUDIO, 'setStreamMute', '(IZ)V', (r, _m, [, id, mute]) => { const direction = mute ? -100 : 100; adjust(r, id === -2147483648 ? (musicActive(r) ? 3 : 2) : id, direction); });   // USE_DEFAULT_STREAM_TYPE: the suggested stream
  def(AUDIO, 'getVibrateSetting', '(I)I', () => 0);
  def(AUDIO, 'setVibrateSetting', '(II)V', () => {});
  def(AUDIO, 'shouldVibrate', '(I)Z', () => 0);

  // ---- Spatializer (API 32): a new android.media.Spatializer per getSpatializer() call, its calls answered as AudioService / SpatializerHelper answer on a device without a spatializer effect
  //      (ro.audio.spatializer_enabled false: init(effectExpected=false) leaves STATE_NOT_SUPPORTED and setFeatureEnabled(false) changes nothing; the spatial_audio_enabled secure setting
  //      holds no device list on a clean image). Level SPATIALIZER_IMMERSIVE_LEVEL_NONE, neither enabled nor available, nothing can be spatialized, no head tracker, no compatible device;
  //      the state and head-tracker listeners register (CallbackUtil rules) and never fire. The @SystemApi part needs MODIFY_DEFAULT_AUDIO_EFFECTS (signature|privileged: never granted to
  //      a third-party app), so it throws AudioService's SecurityException after Spatializer's own argument checks; with the permission held it answers like the helper in STATE_NOT_SUPPORTED.
  const SPAT = 'Landroid/media/Spatializer;', SPAT_LISTENER = 'Landroid/media/Spatializer$OnSpatializerStateChangedListener;', TRACKER_LISTENER = 'Landroid/media/Spatializer$OnHeadTrackerAvailableListener;';
  const MODE_TRACKING_LISTENER = 'Landroid/media/Spatializer$OnHeadTrackingModeChangedListener;', POSE_LISTENER = 'Landroid/media/Spatializer$OnHeadToSoundstagePoseUpdatedListener;', OUTPUT_LISTENER = 'Landroid/media/Spatializer$OnSpatializerOutputChangedListener;';
  const DEVICE_ATTRIBUTES = 'Landroid/media/AudioDeviceAttributes;';
  type(SPAT, OBJECT, [], { allocatable: true });
  for (const [name, value] of Object.entries({ SPATIALIZER_IMMERSIVE_LEVEL_OTHER: -1, SPATIALIZER_IMMERSIVE_LEVEL_NONE: 0, SPATIALIZER_IMMERSIVE_LEVEL_MULTICHANNEL: 1, SPATIALIZER_IMMERSIVE_LEVEL_MCHAN_BED_PLUS_OBJECTS: 2,
    HEAD_TRACKING_MODE_UNSUPPORTED: -2, HEAD_TRACKING_MODE_DISABLED: -1, HEAD_TRACKING_MODE_OTHER: 0, HEAD_TRACKING_MODE_RELATIVE_WORLD: 1, HEAD_TRACKING_MODE_RELATIVE_DEVICE: 2 })) staticField(SPAT, name, 'I', () => value);
  const spat = (r, self) => r.object(self).spatializer ??= { state: [], tracker: [], tracking: [], pose: null, output: null };
  def(AUDIO, 'getSpatializer', `()${SPAT}`, r => r.allocate(SPAT));
  def(SPAT, 'getImmersiveAudioLevel', '()I', () => 0);
  def(SPAT, 'isEnabled', '()Z', () => 0);
  def(SPAT, 'isAvailable', '()Z', () => 0);
  def(SPAT, 'isHeadTrackerAvailable', '()Z', () => 0);
  def(SPAT, 'canBeSpatialized', `(${ATTRIBUTES}${FORMAT})Z`, (r, _m, [, attributes, format]) => { if (isNull(attributes) || isNull(format)) npe(r); return 0; });   // STATE_NOT_SUPPORTED: false whatever the usage
  def(SPAT, 'addOnSpatializerStateChangedListener', `(${EXECUTOR}${SPAT_LISTENER})V`, (r, _m, [self, executor, listener]) => { addListener(r, spat(r, self).state, executor, listener, 'addOnSpatializerStateChangedListener'); });
  def(SPAT, 'removeOnSpatializerStateChangedListener', `(${SPAT_LISTENER})V`, (r, _m, [self, listener]) => { removeListener(r, spat(r, self).state, listener, 'removeOnSpatializerStateChangedListener'); });
  def(SPAT, 'addOnHeadTrackerAvailableListener', `(${EXECUTOR}${TRACKER_LISTENER})V`, (r, _m, [self, executor, listener]) => { addListener(r, spat(r, self).tracker, executor, listener, 'addOnHeadTrackerAvailableListener'); });
  def(SPAT, 'removeOnHeadTrackerAvailableListener', `(${TRACKER_LISTENER})V`, (r, _m, [self, listener]) => { removeListener(r, spat(r, self).tracker, listener, 'removeOnHeadTrackerAvailableListener'); });
  const MODE_TEXT = { [-2]: 'HEAD_TRACKING_MODE_UNSUPPORTED', [-1]: 'HEAD_TRACKING_MODE_DISABLED', 0: 'HEAD_TRACKING_MODE_OTHER', 1: 'HEAD_TRACKING_MODE_RELATIVE_WORLD', 2: 'HEAD_TRACKING_MODE_RELATIVE_DEVICE' };
  def(SPAT, 'headtrackingModeToString', `(I)${STRING}`, (r, _m, [mode]) => r.javaString(MODE_TEXT[mode] ?? `head tracking mode unknown ${mode}`), STATIC);
  // @SystemApi(PRIVILEGED_APPS): AudioService.enforceModifyDefaultAudioEffectsPermission after the Spatializer-side argument checks
  const effects = r => { if (!holds(r, 'android.permission.MODIFY_DEFAULT_AUDIO_EFFECTS')) r.throwJava('Ljava/lang/SecurityException;', 'Missing MODIFY_DEFAULT_AUDIO_EFFECTS permission'); };
  const privileged = (name, signature, answer, check) => def(SPAT, name, signature, (r, _m, args) => { check?.(r, args); effects(r); return answer(r, args); });
  const noSpatializer = (r, text) => r.throwJava('Ljava/lang/IllegalStateException;', text);
  const deviceFirst = (r, [, device]) => { if (isNull(device)) npe(r); };
  const stateful = name => () => { throw new APKError(`Spatializer.${name}: the spatial audio device list of a privileged caller is not modelled`, { kind: 'unsupported-audio' }); };
  privileged('isAvailableForDevice', `(${DEVICE_ATTRIBUTES})Z`, () => 0, deviceFirst);      // no SADeviceState: no device is available
  privileged('hasHeadTracker', `(${DEVICE_ATTRIBUTES})Z`, () => 0, deviceFirst);            // !mIsHeadTrackingSupported
  privileged('isHeadTrackerEnabled', `(${DEVICE_ATTRIBUTES})Z`, () => 0, deviceFirst);
  privileged('setHeadTrackerEnabled', `(Z${DEVICE_ATTRIBUTES})V`, stateful('setHeadTrackerEnabled'), (r, [, , device]) => { if (isNull(device)) npe(r); });
  privileged('setEnabled', '(Z)V', () => {});                                                // setFeatureEnabled on STATE_NOT_SUPPORTED: "Can't enabled Spatial Audio, unsupported"
  privileged('getCompatibleAudioDevices', `()${LIST}`, r => emptyList(r));
  privileged('addCompatibleAudioDevice', `(${DEVICE_ATTRIBUTES})V`, stateful('addCompatibleAudioDevice'), deviceFirst);
  privileged('removeCompatibleAudioDevice', `(${DEVICE_ATTRIBUTES})V`, () => {}, deviceFirst);   // no device in the list: nothing to disable
  privileged('getHeadTrackingMode', '()I', () => -2);                                        // mActualHeadTrackingMode: HEAD_TRACKING_MODE_UNSUPPORTED
  privileged('getDesiredHeadTrackingMode', '()I', () => 1);                                  // mDesiredHeadTrackingMode: HEAD_TRACKING_MODE_RELATIVE_WORLD
  privileged('getSupportedHeadTrackingModes', `()${LIST}`, r => emptyList(r));
  privileged('setDesiredHeadTrackingMode', '(I)V', () => {});                                // checkSpatForHeadTracking: no spatializer
  privileged('recenterHeadTracker', '()V', () => {});
  privileged('setGlobalTransform', '([F)V', () => {}, (r, [, transform]) => { if (isNull(transform)) npe(r); const length = r.array(transform).cells.length; if (length !== 6) r.throwJava('Ljava/lang/IllegalArgumentException;', `transform array must be of size 6, was ${length}`); });
  privileged('setEffectParameter', '(I[B)V', (r, [, key]) => noSpatializer(r, `Can't set parameter key:${key} without a spatializer`), (r, [, , value]) => { if (isNull(value)) npe(r); });
  privileged('getEffectParameter', '(I[B)V', (r, [, key]) => noSpatializer(r, `Can't get parameter key:${key} without a spatializer`), (r, [, , value]) => { if (isNull(value)) npe(r); });
  privileged('getOutput', '()I', r => noSpatializer(r, "Can't get output without a spatializer"));
  def(SPAT, 'addOnHeadTrackingModeChangedListener', `(${EXECUTOR}${MODE_TRACKING_LISTENER})V`, (r, _m, [self, executor, listener]) => { addListener(r, spat(r, self).tracking, executor, listener, 'addOnHeadTrackingModeChangedListener', effects); });
  def(SPAT, 'removeOnHeadTrackingModeChangedListener', `(${MODE_TRACKING_LISTENER})V`, (r, _m, [self, listener]) => { removeListener(r, spat(r, self).tracking, listener, 'removeOnHeadTrackingModeChangedListener', effects); });
  // the pose and output listeners are kept before the service registration, so a refused registration leaves them set (Spatializer.java catches only RemoteException there)
  const single = (slot, setName, clearName, listenerType, afterRegister) => {
    def(SPAT, setName, `(${EXECUTOR}${listenerType})V`, (r, _m, [self, executor, listener]) => {
      if (isNull(executor) || isNull(listener)) npe(r);
      const s = spat(r, self); if (s[slot]) r.throwJava('Ljava/lang/IllegalStateException;', 'Trying to overwrite existing listener');
      s[slot] = { executor, listener }; effects(r); afterRegister?.(r);
    });
    def(SPAT, clearName, '()V', (r, _m, [self]) => { const s = spat(r, self); if (!s[slot]) r.throwJava('Ljava/lang/IllegalStateException;', 'No listener to clear'); effects(r); s[slot] = null; });
  };
  single('pose', 'setOnHeadToSoundstagePoseUpdatedListener', 'clearOnHeadToSoundstagePoseUpdatedListener', POSE_LISTENER);
  single('output', 'setOnSpatializerOutputChangedListener', 'clearOnSpatializerOutputChangedListener', OUTPUT_LISTENER, r => noSpatializer(r, "Can't get output without a spatializer"));   // it reports getOutput() at once

  return { roots(visit) { for (const entry of focus) { visit(entry.key); if (entry.listener) visit(entry.listener); if (entry.request) visit(entry.request); } for (const list of [deviceCallbacks, playbackCallbacks, recordingCallbacks]) for (const ref of list) visit(ref); for (const entry of [...communicationListeners, ...modeListeners]) { visit(entry.executor); visit(entry.listener); } if (state.communication) visit(state.communication); }, state };
}

/**
 * android.media.RingtoneManager (android-13.0.0_r1) over the settings provider: the default URIs are the settings URIs, the "actual default" of a type is whatever the app set (a clean image
 * stores none of its own: the virtual device ships no media provider and no ring/notification/alarm sounds, so the lookups answer null). Opening a Ringtone needs the media stack and is refused
 * explicitly instead of returning an object that cannot play.
 */
export function installRingtoneManager({ platform, def, type, holds }) {
  const RM = 'Landroid/media/RingtoneManager;', URI = 'Landroid/net/Uri;', CONTEXT = 'Landroid/content/Context;';
  
  const DEFAULTS = [[1, 'content://settings/system/ringtone'], [2, 'content://settings/system/notification_sound'], [4, 'content://settings/system/alarm_alert']];
  const parse = (r, text) => r.dispatch({ owner: URI, name: 'parse', parameters: ['Ljava/lang/String;'], result: URI, signature: `(Ljava/lang/String;)${URI}` }, [text], 'static');
  const uriText = (r, uri) => r.stringCharacters(r.dispatch({ owner: URI, name: 'toString', parameters: [], result: 'Ljava/lang/String;', signature: '()Ljava/lang/String;' }, [uri], 'virtual'));
  const chosen = new Map();
  def(RM, 'getDefaultUri', '(I)Landroid/net/Uri;', (r, _m, [kind]) => { const hit = DEFAULTS.find(([bit]) => kind & bit); return hit ? parse(r, hit[1]) : null; }, { static: true });
  def(RM, 'getDefaultType', `(${URI})I`, (r, _m, [uri]) => {
    if (uri === null || uri === undefined || uri === 0) return -1;
    const text = uriText(r, uri), hit = DEFAULTS.find(([, value]) => value === text); return hit ? hit[0] : -1;
  }, { static: true });
  def(RM, 'isDefault', `(${URI})Z`, (r, _m, [uri]) => uri !== null && uri !== 0 && DEFAULTS.some(([, value]) => value === uriText(r, uri)) ? 1 : 0, { static: true });
  def(RM, 'getActualDefaultRingtoneUri', `(${CONTEXT}I)${URI}`, (r, _m, [, kind]) => chosen.get(kind) ?? null, { static: true });
  def(RM, 'setActualDefaultRingtoneUri', `(${CONTEXT}I${URI})V`, (r, _m, [, kind, uri]) => {
    if (!holds(r, 'android.permission.WRITE_SETTINGS')) r.throwJava('Ljava/lang/SecurityException;', `uid ${platform.virtualProcess.uid} does not have android.permission.WRITE_SETTINGS.`);
    if (!DEFAULTS.some(([bit]) => kind === bit)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid ringtone type ${kind}`);
    if (uri === null || uri === 0) chosen.delete(kind); else chosen.set(kind, uri);
  }, { static: true });
  def(RM, 'getValidRingtoneUri', `(${CONTEXT})${URI}`, () => null, { static: true });   // no sounds installed

  // ---- Ringtone: the device has no sound to play, so a Ringtone is a valid object that never plays (play() is the silent no-op of a Ringtone with neither local nor remote playback)
  const RT = 'Landroid/media/Ringtone;', ATTRS = 'Landroid/media/AudioAttributes;', MATRIX = 'Landroid/database/MatrixCursor;', CURSOR = 'Landroid/database/Cursor;', ACTIVITY = 'Landroid/app/Activity;';
  type(RT, OBJECT, [], { allocatable: true }); type(RM, OBJECT, [], { allocatable: true });
  const streamForType = kind => (kind & 4) ? 4 : (kind & 2) ? 5 : 2;
  const state = (r, self) => r.object(self).ringtone ??= { uri: null, volume: 1, looping: false, attributes: null, stream: 2, haptic: false };
  const uriSegment = (r, uri) => nullish(uri) ? null : (() => { const v = r.dispatch({ owner: URI, name: 'getLastPathSegment', parameters: [], result: STRING, signature: `()${STRING}` }, [uri], 'virtual'); return nullish(v) ? null : r.stringCharacters(v); })();
  const nullish = v => v === null || v === undefined || v === 0;
  const makeRingtone = (r, uri, stream) => { const o = r.allocate(RT); const st = state(r, o); st.uri = nullish(uri) ? null : uri; st.stream = stream; return o; };
  def(RT, 'getUri', `()${URI}`, (r, _m, [self]) => state(r, self).uri);
  def(RT, 'isPlaying', '()Z', () => 0);
  def(RT, 'play', '()V', () => {});
  def(RT, 'stop', '()V', () => {});
  def(RT, 'setVolume', '(F)V', (r, _m, [self, volume]) => { state(r, self).volume = volume < 0 ? 0 : volume > 1 ? 1 : volume; });
  def(RT, 'getVolume', '()F', (r, _m, [self]) => state(r, self).volume);
  def(RT, 'setLooping', '(Z)V', (r, _m, [self, looping]) => { state(r, self).looping = looping ? 1 : 0; });
  def(RT, 'isLooping', '()Z', (r, _m, [self]) => state(r, self).looping ? 1 : 0);
  def(RT, 'setHapticGeneratorEnabled', '(Z)V', (r, _m, [self, on]) => { state(r, self).haptic = on ? 1 : 0; });
  def(RT, 'isHapticGeneratorEnabled', '()Z', (r, _m, [self]) => state(r, self).haptic ? 1 : 0);
  def(RT, 'setAudioAttributes', `(${ATTRS})V`, (r, _m, [self, attributes]) => {
    if (nullish(attributes)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid null AudioAttributes for Ringtone');
    const st = state(r, self); st.attributes = attributes;
    st.stream = r.dispatch({ owner: ATTRS, name: 'getVolumeControlStream', parameters: [], result: 'I', signature: '()I' }, [attributes], 'virtual');
  });
  def(RT, 'getAudioAttributes', `()${ATTRS}`, (r, _m, [self]) => {
    const st = state(r, self); if (st.attributes) return st.attributes;
    const builder = r.allocate('Landroid/media/AudioAttributes$Builder;'); r.dispatch({ owner: 'Landroid/media/AudioAttributes$Builder;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [builder], 'direct');
    for (const [name, value] of [['setUsage', 6], ['setContentType', 4]]) r.dispatch({ owner: 'Landroid/media/AudioAttributes$Builder;', name, parameters: ['I'], result: 'Landroid/media/AudioAttributes$Builder;', signature: '(I)Landroid/media/AudioAttributes$Builder;' }, [builder, value], 'virtual');
    return st.attributes = r.dispatch({ owner: 'Landroid/media/AudioAttributes$Builder;', name: 'build', parameters: [], result: ATTRS, signature: `()${ATTRS}` }, [builder], 'virtual');
  });
  def(RT, 'setStreamType', '(I)V', (r, _m, [self, stream]) => { const st = state(r, self); st.stream = stream; st.attributes = null; });
  def(RT, 'getStreamType', '()I', (r, _m, [self]) => state(r, self).stream);
  def(RT, 'getTitle', `(${CONTEXT})${STRING}`, (r, _m, [self]) => r.javaString(uriSegment(r, state(r, self).uri) ?? 'Unknown ringtone'));
  def(RT, 'getTitle', `(${CONTEXT}${URI}ZZ)${STRING}`, (r, _m, [, uri]) => r.javaString(uriSegment(r, uri) ?? 'Unknown ringtone'), { static: true });
  def(RM, 'getRingtone', `(${CONTEXT}${URI})${RT}`, (r, _m, [, uri]) => makeRingtone(r, uri, 2), { static: true });
  def(RM, 'getRingtone', `(${CONTEXT}${URI}I)${RT}`, (r, _m, [, uri, stream]) => makeRingtone(r, uri, stream), { static: true });
  def(RM, 'hasHapticChannels', `(${URI})Z`, () => 0, { static: true });
  def(RM, 'hasHapticChannels', '(I)Z', () => 0, { static: true });

  // ---- RingtoneManager instances: a cursor over the sounds the device has, which is none
  const manager = (r, self) => r.object(self).ringtones ??= { type: 1, cursor: null, stopPrevious: true, previous: null };
  def(RM, '<init>', `(${CONTEXT})V`, (r, _m, [self, context]) => { if (nullish(context)) r.throwJava('Ljava/lang/NullPointerException;', null); manager(r, self); });
  def(RM, '<init>', `(${ACTIVITY})V`, (r, _m, [self, context]) => { if (nullish(context)) r.throwJava('Ljava/lang/NullPointerException;', null); manager(r, self); });
  def(RM, 'setType', '(I)V', (r, _m, [self, kind]) => { const m = manager(r, self); if (m.cursor) r.throwJava('Ljava/lang/IllegalStateException;', 'Setting filter columns should be done before querying for the cursor'); m.type = kind; });
  def(RM, 'getCursor', `()${CURSOR}`, (r, _m, [self]) => {
    const m = manager(r, self); if (m.cursor) return m.cursor;
    const columns = r.newArray('[Ljava/lang/String;', 4); r.array(columns).elements = ['_id', 'title', '"content://media/external/audio/media"', 'title_key'].map(c => r.javaString(c));
    const cursor = r.allocate(MATRIX); r.dispatch({ owner: MATRIX, name: '<init>', parameters: ['[Ljava/lang/String;'], result: 'V', signature: '([Ljava/lang/String;)V' }, [cursor, columns], 'direct');
    return m.cursor = cursor;
  });
  def(RM, 'getRingtonePosition', `(${URI})I`, () => -1);
  def(RM, 'getRingtoneUri', '(I)Landroid/net/Uri;', () => null);
  def(RM, 'getRingtone', `(I)${RT}`, (r, _m, [self]) => { const m = manager(r, self); if (m.stopPrevious && m.previous) { /* a previous Ringtone never plays */ } return m.previous = makeRingtone(r, null, streamForType(m.type)); });
  def(RM, 'setStopPreviousRingtone', '(Z)V', (r, _m, [self, stop]) => { manager(r, self).stopPrevious = stop ? 1 : 0; });
  def(RM, 'getStopPreviousRingtone', '()Z', (r, _m, [self]) => manager(r, self).stopPrevious ? 1 : 0);
  def(RM, 'stopPreviousRingtone', '()V', (r, _m, [self]) => { manager(r, self).previous = null; });
  def(RM, 'setIncludeDrm', '(Z)V', () => {}); def(RM, 'getIncludeDrm', '()Z', () => 0);
  return { roots(visit) { for (const uri of chosen.values()) visit(uri); } };
}
