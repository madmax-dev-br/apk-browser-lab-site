import { mixerOf } from './audio-native.js?v=b8911598aecd';
import { APKError } from './apk-error.js?v=b8911598aecd';

// android.media.AudioManager on the virtual device (android-13.0.0_r1 AudioService / MediaFocusControl contracts), installed on the host type `AudioManagerImpl`:
//   * stream volumes with Android's default maxima and indexes, adjust*() with mute/unmute/toggle, and the ringer mode with the Do Not Disturb rule: toggling silent mode changes the
//     zen state, which an app targeting N or later may only do with Notification Policy access (SecurityException "Not allowed to change Do Not Disturb state"), and the device has none;
//   * the audio mode, speakerphone and microphone-mute switches (they need MODIFY_AUDIO_SETTINGS; without it the call is a logged no-op like AudioService.checkAudioSettingsPermission);
//   * the audio focus stack: a new request takes the top and the previous holder is told AUDIOFOCUS_LOSS / LOSS_TRANSIENT / LOSS_TRANSIENT_CAN_DUCK according to the gain asked for;
//     abandoning gives the focus back to the holder underneath (AUDIOFOCUS_GAIN); both the legacy listener form and AudioFocusRequest are keyed by the listener (else the request);
//   * session ids drawn from the same counter as AudioTrack, properties of the output (48 kHz, 192 frames), the built-in devices of AudioManagerDevices with device callbacks, the
//     communication device, sound-effect calls (the device has no sound-effect assets: no-ops) and empty playback / recording configuration lists.
// Listener callbacks are delivered as host events on the main thread (the Handler an AudioFocusRequest names is not used for delivery).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', LISTENER = 'Landroid/media/AudioManager$OnAudioFocusChangeListener;', REQUEST = 'Landroid/media/AudioFocusRequest;';
const DEVICE = 'Landroid/media/AudioDeviceInfo;', DEVICES = 'Landroid/media/AudioManagerDevices;', CALLBACK = 'Landroid/media/AudioDeviceCallback;', HANDLER = 'Landroid/os/Handler;';
const COMM_LISTENER = 'Landroid/media/AudioManager$OnCommunicationDeviceChangedListener;', EXECUTOR = 'Ljava/util/concurrent/Executor;';
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
export function installAudioManager({ platform, def, service, call, holds, emptyList }) {
  const AUDIO = service('audio', 'Landroid/media/AudioManager;');
  const state = { volumes: new Map(), muted: new Set(), ringer: NORMAL, mode: 0, speaker: false, micMute: false, communication: null, sound: false };
  const focus = [];                 // bottom .. top: { key, listener, request, gain, pauseOnDuck, delayed }
  const deviceCallbacks = [], communicationListeners = [], playbackCallbacks = [], recordingCallbacks = [];
  const record = (r, line) => r.record(`AUDIO ${line}`);
  const sdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1);
  const isNull = v => v === null || v === undefined || v === 0;

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
  def(AUDIO, 'setMode', '(I)V', (r, _m, [, mode]) => {
    if (!settingsAllowed(r, 'setMode')) return;
    if (mode === 2 && !holds(r, 'android.permission.MODIFY_PHONE_STATE')) { record(r, 'setMode(MODE_IN_CALL) ignored: MODIFY_PHONE_STATE not granted'); return; }
    if (mode < 0 || mode > 6) return;
    state.mode = mode;
  });
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
  def('Landroid/media/AudioManager;', 'isHapticPlaybackSupported', '()Z', () => 0, { static: true });

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
    if (changed) for (const entry of communicationListeners) platform.queueTask(() => call(r, entry.listener, COMM_LISTENER, 'onCommunicationDeviceChanged', [DEVICE], 'V', [match]), 0, [entry.listener]);
    return 1;
  });
  def(AUDIO, 'clearCommunicationDevice', '()V', () => { state.communication = null; });
  def(AUDIO, 'addOnCommunicationDeviceChangedListener', `(${EXECUTOR}${COMM_LISTENER})V`, (r, _m, [, executor, listener]) => {
    if (isNull(executor) || isNull(listener)) r.throwJava('Ljava/lang/NullPointerException;', 'executor and listener must not be null');
    if (!communicationListeners.some(held => sameKey(held.listener, listener))) communicationListeners.push({ executor, listener });
  });
  def(AUDIO, 'removeOnCommunicationDeviceChangedListener', `(${COMM_LISTENER})V`, (r, _m, [, listener]) => { const at = communicationListeners.findIndex(held => sameKey(held.listener, listener)); if (at >= 0) communicationListeners.splice(at, 1); });

  // ---- playback / recording configurations: no other app is playing or recording on the virtual device -----------------------------------------------------
  def(AUDIO, 'getActivePlaybackConfigurations', '()Ljava/util/List;', r => emptyList(r));
  def(AUDIO, 'getActiveRecordingConfigurations', '()Ljava/util/List;', r => emptyList(r));
  const callbackPair = (register, unregister, list, type) => {
    def(AUDIO, register, `(${type}${HANDLER})V`, (r, _m, [, callback]) => { if (isNull(callback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal null callback'); if (!list.some(held => sameKey(held, callback))) list.push(callback); });
    def(AUDIO, unregister, `(${type})V`, (r, _m, [, callback]) => { const at = list.findIndex(held => sameKey(held, callback)); if (at >= 0) list.splice(at, 1); });
  };
  callbackPair('registerAudioPlaybackCallback', 'unregisterAudioPlaybackCallback', playbackCallbacks, 'Landroid/media/AudioManager$AudioPlaybackCallback;');
  callbackPair('registerAudioRecordingCallback', 'unregisterAudioRecordingCallback', recordingCallbacks, 'Landroid/media/AudioManager$AudioRecordingCallback;');

  return { roots(visit) { for (const entry of focus) { visit(entry.key); if (entry.listener) visit(entry.listener); if (entry.request) visit(entry.request); } for (const list of [deviceCallbacks, playbackCallbacks, recordingCallbacks]) for (const ref of list) visit(ref); for (const entry of communicationListeners) { visit(entry.executor); visit(entry.listener); } if (state.communication) visit(state.communication); }, state };
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
