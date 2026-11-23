// "Photo" and "Record" in the device bar: a screenshot of the device screen as a PNG, and a video of it (MP4 where the browser records it, else WebM), both saved as a download.
// They use what MCP's screenshot and record_screen use: src/screen-capture.js captureImage (the rasters the page already shows, nothing asked of the VM) and the one
// src/screen-recorder.js instance (one recording at a time, whoever started it; it stops by itself at RECORD_MAX_SECONDS). Nothing runs until a button is pressed; while
// recording, one timer updates the button's clock. No process.*.
export const RECORD_MAX_SECONDS = 300, RECORD_FPS = 30;
const pad = n => String(n).padStart(2, '0');
/** "pkg-20261123-142501" for the saved files. */
export function mediaFileName(packageName, date = new Date(), ext = 'png') {
  const base = String(packageName || 'app').replace(/[^\w.-]+/g, '_').slice(0, 80);
  return `${base}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.${ext}`;
}
export const clockText = seconds => `${Math.floor(seconds / 60)}:${pad(Math.floor(seconds % 60))}`;

/**
 * photoButton / recordButton: the bar's buttons. capture() -> { blob, width, height, notes }; recorder: { start(o), stop(), status() }; isRunning() -> an app is shown;
 * getPackage(); save(name, blob); status(message, kind); trace(line); timers injectable for tests.
 */
export function createDeviceMedia({ photoButton, recordButton, capture, recorder, isRunning = () => true, getPackage = () => 'app', save, status = () => {}, trace = () => {}, setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = id => clearInterval(id), now = () => Date.now() }) {
  let tick = null, startedAt = 0, ours = false;
  const label = recordButton.querySelector?.('.dm-label') ?? recordButton;
  const setRecording = on => {
    recordButton.classList.toggle('is-recording', on); recordButton.setAttribute('aria-pressed', String(on));
    recordButton.title = on ? 'Stop recording and save the video' : `Record a video of the screen (saved when you stop; at most ${RECORD_MAX_SECONDS / 60} min)`;
    if (!on) label.textContent = 'Record';
  };
  const stopTick = () => { if (tick !== null) clearTimer(tick); tick = null; };
  async function finish() {
    stopTick(); recordButton.disabled = true;
    try {
      const video = await recorder.stop();
      save(mediaFileName(getPackage(), new Date(), video.container), video.blob);
      const line = `Screen video saved: ${video.seconds} s, ${video.width}×${video.height}, ${video.container.toUpperCase()}${video.endedBy === 'limit' ? ` (stopped at the ${RECORD_MAX_SECONDS / 60} min limit)` : ''}`;
      status(line, 'ok'); trace(line);
    } catch (error) { status(`The video could not be saved: ${error?.message ?? error}`, 'error'); }
    finally { ours = false; setRecording(false); recordButton.disabled = false; }
  }
  photoButton.addEventListener('click', async () => {
    if (!isRunning()) { status('Open an app to take a photo of its screen.', 'error'); return; }
    photoButton.disabled = true;
    try {
      const shot = await capture();
      save(mediaFileName(getPackage(), new Date(), 'png'), shot.blob);
      const line = `Screen photo saved: ${shot.width}×${shot.height} PNG${shot.notes?.length ? ` (${shot.notes.join('; ')})` : ''}`;
      status(line, 'ok'); trace(line);
    } catch (error) { status(`The photo could not be taken: ${error?.message ?? error}`, 'error'); }
    finally { photoButton.disabled = false; }
  });
  recordButton.addEventListener('click', () => {
    if (ours) { finish(); return; }
    if (!isRunning()) { status('Open an app to record its screen.', 'error'); return; }
    let started; try { started = recorder.start({ fps: RECORD_FPS, maxSeconds: RECORD_MAX_SECONDS }); }
    catch (error) { status(error?.code === 'busy' ? 'A recording is already running (started by MCP): stop it there first.' : `The screen could not be recorded: ${error?.message ?? error}`, 'error'); return; }
    ours = true; startedAt = now(); setRecording(true); label.textContent = `Stop ${clockText(0)}`;
    trace(`Recording the screen: ${started.width}×${started.height} at ${started.fps} fps, ${started.container.toUpperCase()}`);
    tick = setTimer(() => {
      const state = recorder.status?.();
      if (state && !state.recording) { finish(); return; }   // it stopped by itself at the limit: saved like a stop
      label.textContent = `Stop ${clockText((now() - startedAt) / 1000)}`;
    }, 500);
  });
  setRecording(false);
  return { get recording() { return ours; }, stop: () => (ours ? finish() : Promise.resolve()) };
}
