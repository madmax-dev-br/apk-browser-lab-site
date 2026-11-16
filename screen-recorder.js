// A video of the device's screen, for the MCP tool record_screen (src/mcp-tools.js): while it records, the screen is painted on a canvas `fps` times a second from the content
// rasters the page already shows (src/screen-capture.js paintScreen: the frame the user sees, nothing asked of the VM) and the browser's MediaRecorder encodes the canvas's
// stream. The same limit as a screenshot applies: Views the page draws with its own DOM have no raster, so a screen made only of them cannot be recorded (start says so).
// One recording at a time; it stops by itself at `maxSeconds`, and the finished video is kept until it is taken or the next recording starts. No process.*.

export const RECORDING_FORMATS = Object.freeze({ mp4: ['video/mp4;codecs=avc1.42E01E', 'video/mp4'], webm: ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] });
export const RECORDING_LIMITS = Object.freeze({ fps: [1, 30, 12], maxWidth: [120, 2048, 1080], maxSeconds: [1, 300, 60] });
const failure = (code, message) => Object.assign(new Error(message), { code });
const within = (value, [min, max, fallback]) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
/** The container of a recording's MIME type: 'mp4' | 'webm'. */
export const containerOf = type => /^video\/mp4/i.test(String(type)) ? 'mp4' : 'webm';

/**
 * paint(canvas, { limit, fit }) -> { width, height, domViews }: paints the screen (throws when there is nothing to paint). MediaRecorderImpl / createCanvas / timers: the
 * browser's, injectable for tests. Returns { start(options), stop(), status(), take(), discard() }.
 */
export function createScreenRecorder({ paint, MediaRecorderImpl = globalThis.MediaRecorder, createCanvas = () => globalThis.document.createElement('canvas'), setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = id => clearInterval(id), later = (fn, ms) => setTimeout(fn, ms), cancelLater = id => clearTimeout(id), now = () => Date.now() }) {
  let active = null, finished = null;
  /** The first MIME type of the wanted container the browser records; with no preference, MP4 where it can (it plays everywhere), else WebM. */
  function pickType(format) {
    const supported = type => typeof MediaRecorderImpl?.isTypeSupported !== 'function' || MediaRecorderImpl.isTypeSupported(type);
    for (const name of format ? [format] : ['mp4', 'webm']) { const type = (RECORDING_FORMATS[name] ?? []).find(supported); if (type) return type; }
    return null;
  }
  const describe = recording => ({ type: recording.type, container: containerOf(recording.type), fps: recording.fps, width: recording.width, height: recording.height, frames: recording.frames, skippedFrames: recording.skipped, seconds: Math.round(((recording.endedAt ?? now()) - recording.startedAt) / 100) / 10, maxSeconds: recording.maxSeconds, ...(recording.notes.size ? { notes: [...recording.notes] } : {}) });
  function frame(recording) {
    try { const painted = paint(recording.canvas, { fit: true }); recording.frames++; if (painted?.domViews) recording.notes.add(`${painted.domViews} Views drawn by the page's DOM do not appear in the video`); recording.track?.requestFrame?.(); }
    catch { recording.skipped++; }   // no screen at this instant (the app closed, a screen with no raster): the video keeps its last frame
  }
  /** Ends the encoder and resolves with the finished recording (kept for take()). */
  function finish(recording, reason) {
    if (recording.ending) return recording.ending;
    clearTimer(recording.timer); cancelLater(recording.limitTimer); frame(recording);   // a last frame: the video's length is the recording's
    recording.endedAt = now(); recording.endReason = reason;
    recording.ending = new Promise(resolve => {
      const done = () => {
        const blob = new Blob(recording.chunks, { type: recording.type.split(';')[0] });
        for (const track of recording.stream?.getTracks?.() ?? []) { try { track.stop(); } catch { /* already ended */ } }
        recording.canvas.width = 0; recording.canvas.height = 0;
        finished = { blob, ...describe(recording), bytes: blob.size, endedBy: reason }; if (active === recording) active = null; resolve(finished);
      };
      recording.recorder.onstop = done; recording.recorder.onerror = event => { recording.notes.add(`the encoder stopped with an error: ${event?.error?.message ?? event?.error?.name ?? 'unknown'}`); done(); };
      try { recording.recorder.stop(); } catch { done(); }
    });
    return recording.ending;
  }
  return {
    /** Starts recording. options: { fps, maxWidth, maxSeconds, format: 'mp4' | 'webm' }. Throws when one is running, the browser cannot record, or the screen has nothing to paint. */
    start({ fps, maxWidth, maxSeconds, format = null } = {}) {
      if (active) throw failure('busy', 'A recording is already in progress: stop it (stop) before starting another.');
      if (typeof MediaRecorderImpl !== 'function') throw failure('unsupported', 'This browser has no MediaRecorder: the screen cannot be recorded.');
      if (format !== null && !Object.hasOwn(RECORDING_FORMATS, format)) throw failure('bad-args', 'format is "mp4" or "webm".');
      const type = pickType(format); if (!type) throw failure('unsupported', format ? `This browser cannot record ${format}; try ${format === 'mp4' ? 'webm' : 'mp4'} or leave format out.` : 'This browser cannot record video in mp4 or webm.');
      const canvas = createCanvas(), rate = Math.round(within(fps, RECORDING_LIMITS.fps)), limit = Math.round(within(maxWidth, RECORDING_LIMITS.maxWidth)), seconds = within(maxSeconds, RECORDING_LIMITS.maxSeconds);
      const first = paint(canvas, { limit });   // sizes the canvas; a screen with nothing to paint fails here, before anything is recording
      if (canvas.width % 2) canvas.width -= 1; if (canvas.height % 2) canvas.height -= 1;   // video encoders want even sizes
      if (typeof canvas.captureStream !== 'function') throw failure('unsupported', 'This browser cannot capture a canvas stream.');
      let stream = canvas.captureStream(0), track = stream.getVideoTracks?.()[0] ?? null;   // 0: a frame is taken when requestFrame() is called, once per painted frame
      if (typeof track?.requestFrame !== 'function') { stream = canvas.captureStream(rate); track = null; }   // a browser without requestFrame samples the canvas at the rate itself
      const recorder = new MediaRecorderImpl(stream, { mimeType: type, videoBitsPerSecond: Math.round(Math.max(600_000, Math.min(8_000_000, canvas.width * canvas.height * rate * 0.12))) });
      const recording = { canvas, stream, track, recorder, type: recorder.mimeType || type, fps: rate, width: canvas.width, height: canvas.height, maxSeconds: seconds, chunks: [], frames: 0, skipped: 0, notes: new Set(), startedAt: now(), endedAt: null, timer: null, limitTimer: null, ending: null };
      if (first?.domViews) recording.notes.add(`${first.domViews} Views drawn by the page's DOM do not appear in the video`);
      recorder.ondataavailable = event => { if (event.data?.size) recording.chunks.push(event.data); };
      finished = null; active = recording; recorder.start(1000); frame(recording);
      recording.timer = setTimer(() => frame(recording), Math.round(1000 / rate));
      recording.limitTimer = later(() => { finish(recording, 'limit'); }, seconds * 1000);
      return { recording: true, ...describe(recording) };
    },
    /** Stops the recording (or returns the one that already ended at its limit). -> { blob, type, container, fps, width, height, frames, seconds, bytes, endedBy } */
    async stop() {
      if (active) return finish(active, active.endReason ?? 'stop');
      if (finished) return finished;
      throw failure('bad-args', 'There is no recording: start one with action "start".');
    },
    status() { return active ? { recording: !active.ending, ...describe(active) } : finished ? { recording: false, finished: true, endedBy: finished.endedBy, type: finished.type, container: finished.container, seconds: finished.seconds, frames: finished.frames, bytes: finished.bytes } : { recording: false }; },
    /** Forgets the finished video (after it was delivered, or on request). */
    discard() { const had = !!finished; finished = null; return had; },
    get finished() { return finished; },
  };
}
