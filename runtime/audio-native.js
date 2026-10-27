import { Blocked } from './scheduler.js?v=9b98a94b8ae7';
import { bitsFloat } from './host-contract.js?v=9b98a94b8ae7';
import { readNativeBytes } from './unsafe-native.js?v=9b98a94b8ae7';

// The mixer behind android.media.AudioTrack (framework-aosp/lab-java/android/media/AudioTrack.java): one software track per Java AudioTrack.
//   * written PCM is converted to float32 and queued (stream mode) or kept in the static buffer (static mode);
//   * consumption follows the VM clock at the track's real-time rate while playing; head position, underruns, markers and periodic notifications are derived from it;
//   * a blocking write parks the calling thread (scheduler.Blocked) until the mixer has consumed enough, exactly like a blocking pipe write; a write on a stopped or paused track returns
//     the short count, as the AudioTrack documentation says;
//   * the audio itself goes to a sink: the page's Web Audio output (messages from the worker) or, without a page, a recorder that keeps the PCM for inspection.
// Offloaded playback, tunnelling and effects are not part of this mixer.
const BYTES = { 2: 2, 3: 1, 4: 4, 21: 3, 22: 4 };           // AudioFormat.ENCODING_PCM_16BIT / 8BIT / FLOAT / 24BIT_PACKED / 32BIT
export const OUTPUT_SAMPLE_RATE = 48000;
const SUCCESS = 0, ERROR = -1, BAD_VALUE = -2, INVALID_OPERATION = -3;
const AUDIO_TRACK = 'Landroid/media/AudioTrack;';

/** A sink that keeps what it was given: the default when no page output is attached (tests, headless runs). */
export function createRecordingSink() {
  const tracks = new Map();
  return {
    tracks,
    open(id, format) { tracks.set(id, { ...format, frames: 0, chunks: [], controls: [], volume: [1, 1], rate: 1, closed: false, statics: [] }); },
    queue(id, pcm) { const t = tracks.get(id); if (t) { t.chunks.push(pcm); t.frames += pcm.length / t.channels; } },
    playStatic(id, pcm, options) { tracks.get(id)?.statics.push({ frames: pcm.length / tracks.get(id).channels, ...options }); },
    control(id, op) { tracks.get(id)?.controls.push(op); },
    setVolume(id, left, right) { const t = tracks.get(id); if (t) t.volume = [left, right]; },
    setRate(id, ratio) { const t = tracks.get(id); if (t) t.rate = ratio; },
    close(id) { const t = tracks.get(id); if (t) t.closed = true; },
  };
}

/** A sink that posts everything to the page as { type: 'audio', op, ... } messages (src/web-audio-player.js plays them). */
export function createMessageSink(post) {
  const send = (op, id, payload = {}, transfer = []) => post({ type: 'audio', op, id, ...payload }, transfer);
  return {
    open: (id, format) => send('open', id, { format }),
    queue: (id, pcm) => { const copy = pcm.slice(); send('queue', id, { pcm: copy }, [copy.buffer]); },
    playStatic: (id, pcm, options) => { const copy = pcm.slice(); send('static', id, { pcm: copy, options }, [copy.buffer]); },
    control: (id, op) => send('control', id, { control: op }),
    setVolume: (id, left, right) => send('volume', id, { left, right }),
    setRate: (id, ratio) => send('rate', id, { ratio }),
    close: id => send('close', id),
  };
}

const decode = (encoding, source, offset, count) => {
  const out = new Float32Array(count);
  switch (encoding) {
    case 2: for (let i = 0; i < count; i++) out[i] = source(offset + i) / 32768; break;                                 // int16 elements
    case 4: for (let i = 0; i < count; i++) out[i] = source(offset + i); break;                                          // float elements
    default: throw new Error(`unsupported element decode ${encoding}`);
  }
  return out;
};
const decodeBytes = (encoding, bytes) => {   // little-endian PCM bytes -> float32
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), size = BYTES[encoding], count = Math.floor(bytes.length / size), out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const at = i * size;
    out[i] = encoding === 2 ? view.getInt16(at, true) / 32768 : encoding === 3 ? (bytes[at] - 128) / 128 : encoding === 4 ? view.getFloat32(at, true)
      : encoding === 21 ? (((bytes[at + 2] << 24) | (bytes[at + 1] << 16) | (bytes[at] << 8)) >> 8) / 8388608 : view.getInt32(at, true) / 2147483648;
  }
  return out;
};

export function createAudioMixer({ now, schedule, sink, notify }) {
  const tracks = new Map(); let next = 1, sessions = 0;
  const effectiveRate = t => t.rate * t.speed * (t.rateRatio ?? 1);
  /** Brings the track up to the VM time `at`: consumes what the clock says was played. */
  const advance = (t, at) => {
    if (t.state === 'playing' || t.state === 'draining') {
      const elapsed = Math.max(0, at - t.lastTime); t.lastTime = at;
      t.fraction += elapsed * effectiveRate(t) / 1000; const want = Math.floor(t.fraction); t.fraction -= want;
      if (t.mode === 'stream') {
        const take = Math.min(want, t.queued);
        t.consumed += take; t.queued -= take;
        if (take < want) {
          if (t.state === 'draining') { t.state = 'stopped'; t.fraction = 0; sink.control(t.id, 'stop'); }
          else if (!t.underrun) { t.underruns++; t.underrun = true; }
          t.fraction = 0;
        } else if (t.queued > 0) t.underrun = false;
        if (t.state === 'draining' && t.queued === 0) { t.state = 'stopped'; sink.control(t.id, 'stop'); }
      } else staticAdvance(t, want);
    } else t.lastTime = at;
  };
  const staticAdvance = (t, want) => {   // static mode: play the buffer, honouring the loop points
    let remaining = want;
    while (remaining > 0 && t.state === 'playing') {
      const end = t.loopCount !== 0 ? t.loopEnd : t.written;
      const run = Math.min(remaining, Math.max(0, end - t.position));
      t.position += run; t.consumed += run; remaining -= run;
      if (t.position >= end) {
        if (t.loopCount !== 0 && t.loopEnd > t.loopStart) { if (t.loopCount > 0) t.loopCount--; t.position = t.loopStart; if (t.loopCount === 0 && t.position >= t.written) { t.state = 'stopped'; } }
        else { t.state = 'stopped'; sink.control(t.id, 'stop'); t.position = t.written; }
      }
      if (run === 0 && t.position < end) break;
    }
  };
  const track = id => tracks.get(id);
  const events = t => {   // marker / period notifications, scheduled at the VM time the playback position will reach them
    t.eventToken = (t.eventToken ?? 0) + 1;
    if (t.state !== 'playing' && t.state !== 'draining') return;
    const token = t.eventToken, rate = effectiveRate(t), position = t.consumed;
    let target = Infinity, kind = null;
    if (t.marker > 0 && position < t.marker && !t.markerFired) { target = t.marker; kind = 'marker'; }
    if (t.period > 0) { const nextPeriod = (Math.floor(position / t.period) + 1) * t.period; if (nextPeriod < target) { target = nextPeriod; kind = 'period'; } }
    if (!Number.isFinite(target)) return;
    const available = t.mode === 'stream' ? t.queued : Infinity;
    if (target - position > available) return;                         // the data to reach it has not been written yet: a later write reschedules
    schedule(() => {
      if (t.eventToken !== token) return;
      advance(t, now()); if (t.consumed >= target) { if (kind === 'marker') t.markerFired = true; notify(t, kind === 'marker' ? 3 : 4); }
      events(t);
    }, Math.max(1, Math.ceil((target - position) * 1000 / rate)), t);
  };
  const waitFor = (t, frames) => Math.max(1, Math.ceil(frames * 1000 / Math.max(1, effectiveRate(t))));
  return {
    tracks, advance, events, track,
    sessionId() { return ++sessions + 100; },
    create({ rate, channels, encoding, bufferFrames, mode, usage, contentType, weak }) {
      const id = next++, t = { id, rate, channels, encoding, bytes: BYTES[encoding] ?? 2, bufferFrames, mode: mode === 0 ? 'static' : 'stream', usage, contentType, weak, state: 'stopped', queued: 0, consumed: 0, fraction: 0, lastTime: now(), speed: 1,
        rateRatio: 1, underruns: 0, underrun: false, marker: 0, markerFired: false, period: 0, loopStart: 0, loopEnd: 0, loopCount: 0, written: 0, position: 0, volume: [1, 1], staticData: null, bufferSize: bufferFrames };
      if (t.mode === 'static') t.staticData = new Float32Array(bufferFrames * channels);
      tracks.set(id, t); sink.open(id, { sampleRate: rate, channels, encoding, mode: t.mode, usage, contentType }); return t;
    },
    release(id) { const t = track(id); if (!t) return; t.state = 'stopped'; t.eventToken = (t.eventToken ?? 0) + 1; sink.close(id); tracks.delete(id); },
    start(t) {
      advance(t, now());
      if (t.mode === 'static' && t.state === 'stopped') {
        if (t.written === 0) return;
        t.position = Math.min(t.position, t.written);
        sink.playStatic(t.id, t.staticData.subarray(0, t.written * t.channels), { start: t.position, loopStart: t.loopStart, loopEnd: t.loopEnd, loops: t.loopCount });
      }
      t.state = 'playing'; t.lastTime = now(); t.underrun = false; sink.control(t.id, 'play'); events(t);
    },
    pause(t) { advance(t, now()); if (t.state === 'playing' || t.state === 'draining') { t.state = 'paused'; sink.control(t.id, 'pause'); } t.eventToken++; },
    stop(t) {
      advance(t, now());
      if (t.mode === 'stream' && (t.state === 'playing') && t.queued > 0) { t.state = 'draining'; events(t); return; }   // stream mode plays out what was written
      if (t.state !== 'stopped') { t.state = 'stopped'; sink.control(t.id, 'stop'); }
      t.eventToken++;
    },
    flush(t) {   // AudioTrack.flush: only a stopped or paused stream track discards its queue (and its head position goes back to 0)
      advance(t, now());
      if (t.mode === 'stream' && (t.state === 'stopped' || t.state === 'paused')) { t.queued = 0; t.consumed = 0; t.underrun = false; t.markerFired = false; sink.control(t.id, 'flush'); }
      t.eventToken++; events(t);
    },
    /** Queues float32 PCM (interleaved); returns the number of frames taken now. In blocking mode the caller parks until the rest fits. */
    enqueue(t, pcm) {
      advance(t, now());
      const frames = Math.floor(pcm.length / t.channels);
      if (t.mode === 'static') {
        const room = t.bufferFrames - t.written, take = Math.min(frames, room);
        t.staticData.set(pcm.subarray(0, take * t.channels), t.written * t.channels); t.written += take; return take;
      }
      const take = Math.min(frames, Math.max(0, t.bufferSize - t.queued));
      if (take > 0) { t.queued += take; t.underrun = false; sink.queue(t.id, take === frames ? pcm : pcm.subarray(0, take * t.channels)); events(t); }
      return take;
    },
    blockedUntil(t, frames) {   // the VM time at which `frames` more frames fit
      advance(t, now()); const free = t.bufferSize - t.queued; return free >= frames ? 0 : waitFor(t, frames - free);
    },
    setVolume(t, left, right) { t.volume = [left, right]; sink.setVolume(t.id, left, right); },
    setPlaybackRate(t, hz) { advance(t, now()); t.rateRatio = hz / t.rate; sink.setRate(t.id, t.rateRatio * t.speed); events(t); },
    setSpeed(t, speed) { advance(t, now()); t.speed = speed; sink.setRate(t.id, t.rateRatio * speed); events(t); },
    position(t) { advance(t, now()); return t.consumed | 0; },
    waitFor,
  };
}

// ---- natives of android.media.AudioTrack ------------------------------------------------------------------------------------------------------------------------------------------------------------------
const mixers = new WeakMap();
function mixerOf(runtime) {
  let mixer = mixers.get(runtime);
  if (!mixer) {
    const platform = runtime.platform;
    const sink = platform.audioSink ?? (platform.audioSink = createRecordingSink());
    mixer = createAudioMixer({
      now: () => platform.clock.now(), sink,
      schedule: (fn, delay, t) => platform.queueTask(fn, delay, []),
      notify: (t, what) => {   // the track's Java object (weakly held) gets the marker / period event
        const self = deref(runtime, t.weak); if (!self) return;
        runtime.dispatch({ owner: AUDIO_TRACK, name: 'postEventFromHost', parameters: ['I'], result: 'V', signature: '(I)V' }, [self, what], 'direct');
      },
    });
    mixers.set(runtime, mixer);
  }
  return mixer;
}
const deref = (runtime, weak) => { if (weak === null || weak === undefined) return null; const ref = runtime.dispatch({ owner: 'Ljava/lang/ref/Reference;', name: 'get', parameters: [], result: 'Ljava/lang/Object;', signature: '()Ljava/lang/Object;' }, [weak], 'virtual'); return ref === 0 ? null : ref; };
const handleOf = (runtime, self) => runtime.object(self).audioTrack;
const trackOf = (runtime, self) => { const t = handleOf(runtime, self); return t && mixerOf(runtime).track(t); };

export function createAudioNativeBindings() {
  const bindings = new Map(), add = (signature, fn) => bindings.set(`${AUDIO_TRACK}->${signature}`, fn);
  const minFrames = rate => 2 * Math.ceil(rate / 50);   // two 20 ms mixer periods
  add('native_setup(Ljava/lang/Object;II[IIIII[I)I', (runtime, [self, weak, usage, contentType, sampleRate, channelCount, encoding, bufferBytes, mode, session]) => {
    const mixer = mixerOf(runtime), rates = runtime.array(sampleRate).elements, sessions = runtime.array(session).elements;
    let rate = rates[0]; if (rate === 0) rate = OUTPUT_SAMPLE_RATE;
    const size = BYTES[encoding];
    if (!size) return BAD_VALUE;                                                // compressed encodings need a decoder the mixer does not have
    const frameBytes = channelCount * size, frames = Math.floor(bufferBytes / frameBytes);
    if (mode === 1 && frames < 1) return BAD_VALUE;
    const t = mixer.create({ rate, channels: channelCount, encoding, bufferFrames: frames, mode, usage, contentType, weak });
    rates[0] = rate; sessions[0] = sessions[0] > 0 ? sessions[0] : mixer.sessionId();
    runtime.object(self).audioTrack = t.id; return SUCCESS;
  });
  add('native_finalize()V', (runtime, [self]) => { const id = handleOf(runtime, self); if (id) { mixerOf(runtime).release(id); runtime.object(self).audioTrack = 0; } });
  add('native_release()V', (runtime, [self]) => { const id = handleOf(runtime, self); if (id) { mixerOf(runtime).release(id); runtime.object(self).audioTrack = 0; } });
  add('native_start()V', (runtime, [self]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).start(t); });
  add('native_stop()V', (runtime, [self]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).stop(t); });
  add('native_pause()V', (runtime, [self]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).pause(t); });
  add('native_flush()V', (runtime, [self]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).flush(t); });
  const writer = (convert) => (runtime, [self, data, offset, size, format, blocking]) => {
    const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION;
    const mixer = mixerOf(runtime), unit = t.channels;
    const pcm = convert(runtime, data, offset, size, format, t); if (pcm === null) return BAD_VALUE;
    const unitsPerFrame = pcm.unitsPerFrame, total = Math.floor(pcm.samples.length / unit), result = { units: 0 };
    const step = (done) => {                                               // enqueue what fits; park for the rest only while the track plays
      const taken = mixer.enqueue(t, pcm.samples.subarray(done * unit));
      const written = done + taken;
      if (written >= total || !blocking || t.mode === 'static' || (t.state !== 'playing' && t.state !== 'draining')) return written * unitsPerFrame;
      const delay = mixer.blockedUntil(t, 1);
      const resumeAt = runtime.platform.clock.now() + delay;
      return new Blocked({ ready: () => { mixer.advance(t, runtime.platform.clock.now()); return t.bufferSize - t.queued > 0 || t.state === 'stopped' || t.state === 'paused'; }, deadline: resumeAt, interruptible: true, reason: 'AudioTrack.write: mixer buffer full', finish: () => step(written) });
    };
    return step(0);
  };
  add('native_write_byte([BIIIZ)I', writer((runtime, data, offset, size, format, t) => {
    const elements = runtime.array(data).elements, bytes = new Uint8Array(size); for (let i = 0; i < size; i++) bytes[i] = elements[offset + i] & 255;
    const frameBytes = t.channels * (BYTES[format] ?? 2), whole = Math.floor(size / frameBytes) * frameBytes;
    return { samples: decodeBytes(format, bytes.subarray(0, whole)), unitsPerFrame: frameBytes };
  }));
  add('native_write_short([SIIIZ)I', writer((runtime, data, offset, size, format, t) => {
    if (format !== 2) return null; const elements = runtime.array(data).elements, whole = Math.floor(size / t.channels) * t.channels;
    return { samples: decode(2, i => elements[i], offset, whole), unitsPerFrame: t.channels };
  }));
  add('native_write_float([FIIIZ)I', writer((runtime, data, offset, size, format, t) => {
    if (format !== 4) return null; const elements = runtime.array(data).elements, whole = Math.floor(size / t.channels) * t.channels;
    return { samples: decode(4, i => bitsFloat(elements[i]), offset, whole), unitsPerFrame: t.channels };
  }));
  add('native_write_native_bytes(Ljava/nio/ByteBuffer;IIIZ)I', writer((runtime, buffer, position, size, format, t) => {
    const address = BigInt.asIntN(64, runtime.object(buffer).fields.get('Ljava/nio/Buffer;->address:J') ?? 0n) + BigInt(position), frameBytes = t.channels * (BYTES[format] ?? 2), whole = Math.floor(size / frameBytes) * frameBytes;
    return { samples: decodeBytes(format, readNativeBytes(runtime, address, whole)), unitsPerFrame: frameBytes };
  }));
  add('native_get_buffer_size_frames()I', (runtime, [self]) => trackOf(runtime, self)?.bufferSize ?? ERROR);
  add('native_set_buffer_size_frames(I)I', (runtime, [self, frames]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; t.bufferSize = Math.max(1, Math.min(frames, t.bufferFrames)); return t.bufferSize; });
  add('native_get_buffer_capacity_frames()I', (runtime, [self]) => trackOf(runtime, self)?.bufferFrames ?? ERROR);
  add('native_setVolume(FF)V', (runtime, [self, left, right]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).setVolume(t, bitsFloat(left), bitsFloat(right)); });
  add('native_set_playback_rate(I)I', (runtime, [self, hz]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; mixerOf(runtime).setPlaybackRate(t, hz); return SUCCESS; });
  add('native_get_playback_rate()I', (runtime, [self]) => { const t = trackOf(runtime, self); return t ? Math.round(t.rate * t.rateRatio) : 0; });
  add('native_set_playback_speed(F)V', (runtime, [self, speed]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).setSpeed(t, bitsFloat(speed)); });
  add('native_set_marker_pos(I)I', (runtime, [self, marker]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; t.marker = marker; t.markerFired = false; mixerOf(runtime).events(t); return SUCCESS; });
  add('native_get_marker_pos()I', (runtime, [self]) => trackOf(runtime, self)?.marker ?? 0);
  add('native_set_pos_update_period(I)I', (runtime, [self, period]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; t.period = period; mixerOf(runtime).events(t); return SUCCESS; });
  add('native_get_pos_update_period()I', (runtime, [self]) => trackOf(runtime, self)?.period ?? 0);
  add('native_set_position(I)I', (runtime, [self, position]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; if (position < 0 || position > t.written) return BAD_VALUE; t.position = position; t.consumed = position; return SUCCESS; });
  add('native_get_position()I', (runtime, [self]) => { const t = trackOf(runtime, self); return t ? mixerOf(runtime).position(t) : 0; });
  add('native_get_latency()I', () => 40);
  add('native_get_underrun_count()I', (runtime, [self]) => { const t = trackOf(runtime, self); if (t) mixerOf(runtime).advance(t, runtime.platform.clock.now()); return t?.underruns ?? 0; });
  add('native_get_flags()I', (runtime, [self]) => {
    const attributes = runtime.object(self).fields.get(`${AUDIO_TRACK}->mAttributes:Landroid/media/AudioAttributes;`); if (!attributes) return 0;
    return runtime.dispatch({ owner: 'Landroid/media/AudioAttributes;', name: 'getAllFlags', parameters: [], result: 'I', signature: '()I' }, [attributes], 'virtual');
  });
  add('native_get_timestamp([J)I', (runtime, [self, out]) => {
    const t = trackOf(runtime, self); if (!t || t.state === 'stopped') return ERROR;
    const mixer = mixerOf(runtime); mixer.advance(t, runtime.platform.clock.now());
    runtime.array(out).elements = [BigInt(t.consumed), BigInt(Math.round(runtime.platform.clock.now() * 1e6))]; return SUCCESS;
  });
  add('native_set_loop(III)I', (runtime, [self, start, end, count]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; t.loopStart = start; t.loopEnd = end; t.loopCount = count; return SUCCESS; });
  add('native_reload_static()I', (runtime, [self]) => { const t = trackOf(runtime, self); if (!t) return INVALID_OPERATION; t.position = 0; t.consumed = 0; t.state = 'stopped'; return SUCCESS; });
  bindings.set(`${AUDIO_TRACK}->native_get_output_sample_rate(I)I`, () => OUTPUT_SAMPLE_RATE);
  bindings.set(`${AUDIO_TRACK}->native_get_min_buff_size(III)I`, (runtime, [rate, channels, encoding]) => {
    const size = BYTES[encoding] ?? 2; return minFrames(rate) * channels * size;
  });
  return bindings;
}
export { mixerOf };
