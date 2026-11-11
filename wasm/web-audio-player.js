// The page side of android.media.AudioTrack: plays the PCM the worker posts ({ type: 'audio', op, id, ... } from src/audio-native.js createMessageSink) through Web Audio.
// The AudioContext is created on the first message and resumed on the next user gesture (browsers keep it suspended until then); each track has a gain node and a running schedule time,
// stream data is scheduled back to back, static data plays through a looping buffer source.
export function createWebAudioPlayer({ AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext, listen = f => globalThis.addEventListener?.('pointerdown', f, { passive: true }) } = {}) {
  let context = null; const tracks = new Map();
  const ensure = () => { if (!context && AudioContextClass) { context = new AudioContextClass(); listen(() => { if (context.state === 'suspended') context.resume?.(); }); } return context; };
  const track = id => tracks.get(id);
  const bufferOf = (t, pcm) => {
    const frames = Math.floor(pcm.length / t.channels), buffer = context.createBuffer(t.channels, frames, t.sampleRate);
    for (let c = 0; c < t.channels; c++) { const channel = buffer.getChannelData(c); for (let i = 0; i < frames; i++) channel[i] = pcm[i * t.channels + c]; }
    return buffer;
  };
  const stopSources = t => { for (const source of t.sources) { try { source.onended = null; source.stop(); } catch { /* already ended */ } } t.sources.length = 0; t.next = 0; };
  return {
    handle(message) {
      if (message?.type !== 'audio') return false;
      const ctx = ensure(); if (!ctx) return true;
      const { op, id } = message;
      if (op === 'open') { const gain = ctx.createGain(); gain.connect(ctx.destination); tracks.set(id, { ...message.format, gain, sources: [], next: 0, playing: false, pending: [], rate: 1 }); return true; }
      const t = track(id); if (!t) return true;
      if (op === 'queue') {
        if (!t.playing) { t.pending.push(message.pcm); return true; }
        const source = ctx.createBufferSource(); source.buffer = bufferOf(t, message.pcm); source.playbackRate.value = t.rate; source.connect(t.gain);
        const at = Math.max(ctx.currentTime, t.next); source.start(at); t.next = at + source.buffer.duration / t.rate; t.sources.push(source); source.onended = () => { const i = t.sources.indexOf(source); if (i >= 0) t.sources.splice(i, 1); };
      } else if (op === 'static') {
        stopSources(t); const { start = 0, loopStart = 0, loopEnd = 0, loops = 0 } = message.options ?? {}, source = ctx.createBufferSource(); source.buffer = bufferOf(t, message.pcm); source.playbackRate.value = t.rate; source.connect(t.gain);
        if (loops !== 0 && loopEnd > loopStart) { source.loop = true; source.loopStart = loopStart / t.sampleRate; source.loopEnd = loopEnd / t.sampleRate; }
        source.start(0, start / t.sampleRate); t.sources.push(source);
      } else if (op === 'control') {
        if (message.control === 'play') { t.playing = true; if (ctx.state === 'suspended') ctx.resume?.(); const pending = t.pending.splice(0); for (const pcm of pending) this.handle({ type: 'audio', op: 'queue', id, pcm }); }
        else if (message.control === 'pause') { t.playing = false; ctx.suspend?.(); }
        else if (message.control === 'stop') { t.playing = false; }
        else if (message.control === 'flush') { stopSources(t); t.pending.length = 0; }
      } else if (op === 'volume') t.gain.gain.value = (message.left + message.right) / 2;
      else if (op === 'rate') { t.rate = message.ratio; for (const source of t.sources) source.playbackRate.value = t.rate; }
      else if (op === 'close') { stopSources(t); t.gain.disconnect(); tracks.delete(id); }
      return true;
    },
  };
}
