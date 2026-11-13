// The page side of the virtual device's cameras: the "Câmera" section of the Controles panel (which source the cameras look at), the frame loop that feeds the VM, the camera
// stream drawn inside TextureView / SurfaceView elements of the device, and the system camera screen that answers the capture Intents. The Android side is src/camera-host.js.
//
// Cost model. Nothing runs while no app uses the camera (and the section is closed). A preview is drawn by the page straight into the View's element: the Worker gets one small
// message per frame (no pixels) and answers with an ack; a new frame is only sent after the previous one was acknowledged. Pixels cross to the Worker only for ImageReader targets:
// one RGBA buffer per frame at the reader's size (read back from a small 2D canvas, transferred, not copied), and one buffer once for a still capture. A stream that only an encoder
// consumes (a recording) crosses as a VideoFrame of that canvas: no readback, and the Worker's encoder takes it as it is.
import { createCameraSource } from './camera-source.js?v=0ed57297cd19';
import { CAMERAS, cameraById, LENS_FACING_FRONT, inlineThumbnailSize } from './camera-frames.js?v=0ed57297cd19';
import { probeWebCodecs } from './media-codec-backend.js?v=0ed57297cd19';
import { createMp4Writer, splitAnnexB } from './media-mp4.js?v=0ed57297cd19';

const FRAME_MS = 1000 / 30, MONITOR_MS = 200, ACK_TIMEOUT_MS = 1500;
const CAPTURE_SIZE = { width: 960, height: 1280 };   // the upright picture the system camera screen takes (3:4)
const VIDEO_CAPTURE = { width: 720, height: 960, bitrate: 6000000, frameRate: 30 };   // the upright video the system camera screen records (3:4, H.264 in MP4)
const clock = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const facingName = camera => (camera.facing === LENS_FACING_FRONT ? 'frontal' : 'traseira');

export function createCameraLab({ $, vm, documentRef = globalThis.document }) {
  const S = { attached: false, codecs: null, opened: new Set(), streams: new Map(), surfaces: new Set(), capture: null, timer: null, lastTick: 0, lastMonitor: 0, seq: 0, readers: new Map(),
    stats: { frames: 0, pixelFrames: 0, pixelBytes: 0, videoFrames: 0, readbackMs: 0, drawMs: 0, windowStart: 0, windowFrames: 0, fps: 0 } };
  const source = createCameraSource({ onChange: () => { renderPanel(); wake(); } });
  const post = (message, transfer) => vm.cameraMessage?.(message, transfer);
  // The camera screen records with this page's own encoder (WebCodecs). Until the browser has answered, and when it has none, the device has no camera app that records video.
  probeWebCodecs(globalThis).then(codecs => { S.codecs = codecs; if (codecs && S.attached) post({ op: 'capabilities', captureVideo: true }); }, () => {});

  // ---- the panel -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const sectionOpen = () => !!$('cp-sec-camera')?.open;
  function statusText() {
    const parts = [];
    if (!S.attached) parts.push('Nenhum APK aberto: o dispositivo ganha as câmeras 0 (traseira) e 1 (frontal) quando um APK é aberto.');
    else if (!S.opened.size) parts.push('Nenhum app com a câmera aberta: nenhum quadro é gerado para a VM.');
    else for (const id of S.opened) {
      const camera = cameraById(id), stream = S.streams.get(id), sizes = wanted => (stream?.buffers ?? []).filter(b => !!b.video === wanted).map(b => `${b.width}×${b.height}`).join(' e ');
      const pixels = `${sizes(false) ? `, ${sizes(false)} em pixels para o app` : ''}${sizes(true) ? `, ${sizes(true)} para o codificador de vídeo (gravação)` : ''}` || ', prévia desenhada pela página (sem pixels para a VM)';
      parts.push(`Câmera ${id} (${camera ? facingName(camera) : '?'}) aberta pelo app${stream?.active ? `: ${S.stats.fps.toFixed(0)} quadros/s${pixels}` : ', sem pedido de captura ativo'}.`);
    }
    if (S.stats.pixelFrames) parts.push(`Custo medido na página: ${(S.stats.readbackMs / S.stats.pixelFrames).toFixed(2)} ms por quadro com pixels (${(S.stats.pixelBytes / S.stats.pixelFrames / 1024).toFixed(0)} KiB transferidos sem cópia).`);
    return parts.join(' ');
  }
  function renderPanel() {
    const select = $('cam-source'); if (!select) return;
    if (documentRef.activeElement !== select) select.value = source.kind;
    $('cam-summary').textContent = { pattern: 'padrão de teste', webcam: 'webcam', image: 'imagem', video: 'vídeo' }[source.kind];
    $('cam-label').textContent = source.kind === 'pattern' ? 'Padrão de teste gerado pela página: barras, relógio e contador de quadros.' : `${source.kind === 'webcam' ? 'Webcam' : source.kind === 'image' ? 'Imagem' : 'Vídeo'}: ${source.label}${source.size ? ` (${source.size.width}×${source.size.height})` : ''}`;
    const error = $('cam-error'); error.textContent = source.error ? `Fonte não trocada: ${source.error}.` : ''; error.hidden = !source.error;
    $('cam-status').textContent = statusText();
  }
  function chooseFile(kind) {
    const input = $('cam-file'); input.accept = kind === 'image' ? 'image/*' : 'video/*'; input.value = '';
    input.onchange = async () => { const file = input.files?.[0]; input.onchange = null; if (file) await source.select(kind, file); renderPanel(); };
    input.oncancel = () => { input.oncancel = null; renderPanel(); };
    input.click();
  }
  function installPanel() {
    const select = $('cam-source'); if (!select || select._installed) return; select._installed = true;
    select.addEventListener('change', async () => {
      const kind = select.value;
      if (kind === 'image' || kind === 'video') { chooseFile(kind); select.value = source.kind; return; }
      select.disabled = true; try { await source.select(kind); } finally { select.disabled = false; renderPanel(); }
    });
    $('cp-sec-camera')?.addEventListener('toggle', () => { renderPanel(); wake(); });
    renderPanel();
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** device-view.js calls this for every TextureView / SurfaceView element with the node's `cameraSurface` payload (null when the View is no camera surface any more). */
  function bindSurface(element, info) {
    if (!info) { element._cameraCanvas?.remove(); element._cameraCanvas = null; element._cameraInfo = null; S.surfaces.delete(element); return; }
    let canvas = element._cameraCanvas;
    if (!canvas) {
      canvas = element._cameraCanvas = documentRef.createElement('canvas'); canvas.className = 'android-camera-surface'; canvas.setAttribute('aria-hidden', 'true'); canvas._shots = 0;
      canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;transform-origin:0 0';
    }
    if (canvas.parentNode !== element) element.prepend(canvas);
    if (!element.style.position) element.style.position = 'relative';
    element.style.overflow = 'hidden'; element.style.maxWidth = 'none';   // a TextureView may be larger than its parent and scaled down by View transforms (PreviewView does that): its box is the View's, never clamped
    if (info.kind === 'surface' && info.ready && !element.style.backgroundColor) element.style.backgroundColor = '#000';   // a SurfaceView's surface is opaque black until something is queued to it
    const m = info.transform; canvas.style.transform = m ? `matrix(${m[0]},${m[3]},${m[1]},${m[4]},${m[2]},${m[5]})` : '';
    element.setAttribute('aria-label', info.stream ? 'Prévia da câmera' : 'Superfície de câmera (sem imagem)'); element.setAttribute('role', 'img');
    const first = !element._cameraInfo; element._cameraInfo = info; S.surfaces.add(element);
    if (info.stream && (first || info.shots !== canvas._shots)) { canvas._shots = info.shots; drawSurface(element); }
    wake();
  }
  function drawSurface(element) {
    const info = element._cameraInfo, canvas = element._cameraCanvas, stream = info?.stream; if (!stream || !canvas) return;
    // A TextureView holds the buffer turned to the device's natural (portrait) orientation; the app's transform turns it for the display. A SurfaceView's buffer is composited for the
    // display as it is turned (the system applies the display rotation), so it shows the scene upright: in landscape its picture is landscape.
    const front = stream.facing === LENS_FACING_FRONT, rotation = stream.rotation ?? 0, surface = info.kind === 'surface';
    const turn = surface ? ((((front ? stream.orientation + rotation : stream.orientation - rotation)) % 360) + 360) % 360 : stream.orientation, sideways = turn % 180 === 90;
    const width = sideways ? stream.height : stream.width, height = sideways ? stream.width : stream.height;   // the buffer is landscape; upright it is height x width, stretched to the View's box as the consumer does
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    source.drawNatural(canvas.getContext('2d'), width, height, { orientation: turn, rotation: surface ? 0 : rotation, front, mirror: front, crop: stream.crop ?? null });
  }
  function readerCanvas(width, height) {
    const key = `${width}x${height}`; let entry = S.readers.get(key);
    if (!entry) { const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(documentRef.createElement('canvas'), { width, height }); entry = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) }; S.readers.set(key, entry); }
    return entry;
  }
  const sensorView = (camera, view) => ({ rotation: view?.rotation ?? 0, front: camera.facing === LENS_FACING_FRONT, crop: view?.crop ?? null });
  /** One sensor buffer of `camera`: RGBA, width x height, in sensor orientation, as the device is turned and the request crops. */
  function sensorBuffer(camera, width, height, view) {
    const started = performance.now(), { ctx } = readerCanvas(width, height); source.drawSensor(ctx, width, height, camera.orientation, sensorView(camera, view));
    const data = ctx.getImageData(0, 0, width, height).data.buffer; S.stats.readbackMs += performance.now() - started; S.stats.pixelFrames++; S.stats.pixelBytes += data.byteLength; return data;
  }
  /** One sensor buffer of `camera` as a VideoFrame (for an encoder): the canvas itself, no readback. */
  function sensorFrame(camera, width, height, now, view) {
    const { canvas, ctx } = readerCanvas(width, height); source.drawSensor(ctx, width, height, camera.orientation, sensorView(camera, view)); S.stats.videoFrames++;
    return new VideoFrame(canvas, { timestamp: Math.round(now * 1000) });
  }
  function sendFrame(id, stream, now) {
    const camera = cameraById(id); if (!camera) return;
    const buffers = stream.buffers.map(({ width, height, video }) => (video && typeof VideoFrame === 'function' ? { width, height, frame: sensorFrame(camera, width, height, now, stream) } : { width, height, data: sensorBuffer(camera, width, height, stream) }));
    for (const once of stream.once) if (!stream.served.has(once.id)) { stream.served.add(once.id); buffers.push({ width: once.width, height: once.height, once: once.id, data: sensorBuffer(camera, once.width, once.height, once) }); }
    // what each preview of this camera shows now, for TextureView.getBitmap / PixelCopy in the VM: a VideoFrame of its canvas (no readback here)
    const previews = typeof VideoFrame !== 'function' ? [] : liveSurfaces().filter(element => element._cameraInfo.stream.cameraId === id && Number.isSafeInteger(element._cameraInfo.viewId) && element._cameraCanvas?.width > 0).map(element => ({ viewId: element._cameraInfo.viewId, width: element._cameraCanvas.width, height: element._cameraCanvas.height, frame: new VideoFrame(element._cameraCanvas, { timestamp: Math.round(now * 1000) }) }));
    stream.inFlight = ++S.seq; stream.sentAt = now; S.stats.frames++; S.stats.windowFrames++;
    post({ op: 'frame', cameraId: id, seq: stream.inFlight, buffers, previews }, [...buffers.map(buffer => buffer.frame ?? buffer.data), ...previews.map(preview => preview.frame)]);
  }

  // ---- the frame loop --------------------------------------------------------------------------------------------------------------------------------------------------------
  const liveSurfaces = () => { for (const element of [...S.surfaces]) if (!element.isConnected) S.surfaces.delete(element); return [...S.surfaces].filter(element => element._cameraInfo?.stream?.live); };
  const captureLive = () => S.capture?.stage === 'live' || S.capture?.stage === 'recording';
  const needed = () => captureLive() || [...S.streams.values()].some(stream => stream.active) || liveSurfaces().length > 0 || sectionOpen();
  function wake() { if (S.timer === null && needed()) schedule(); }
  function schedule() { S.timer = documentRef.visibilityState === 'visible' && typeof requestAnimationFrame === 'function' ? { raf: requestAnimationFrame(tick) } : { timeout: setTimeout(() => tick(performance.now()), 100) }; }
  function tick(now) {
    S.timer = null; if (!needed()) { renderPanel(); return; }
    const streaming = captureLive() || [...S.streams.values()].some(stream => stream.active) || liveSurfaces().length > 0;
    if (streaming && now - S.lastTick >= FRAME_MS - 3) {
      S.lastTick = now; source.advance(); const started = performance.now();
      for (const element of liveSurfaces()) drawSurface(element);
      if (captureLive()) { drawCapture(); if (S.capture.stage === 'recording') recordFrame(now); }
      S.stats.drawMs += performance.now() - started;
      for (const [id, stream] of S.streams) {
        if (!stream.active) continue;
        if (stream.inFlight !== null && now - stream.sentAt < ACK_TIMEOUT_MS) continue;   // the app has not finished the previous frame: this one is dropped for the VM
        sendFrame(id, stream, now);
      }
    }
    if (sectionOpen() && now - S.lastMonitor >= MONITOR_MS) {
      S.lastMonitor = now; if (!streaming) source.advance();
      const monitor = $('cam-monitor'); if (monitor) source.drawUpright(monitor.getContext('2d'), 0, 0, monitor.width, monitor.height);
      if (now - S.stats.windowStart >= 1000) { S.stats.fps = S.stats.windowFrames * 1000 / (now - S.stats.windowStart); S.stats.windowStart = now; S.stats.windowFrames = 0; }
      $('cam-status').textContent = statusText();
    }
    schedule();
  }

  // ---- the system camera screen (the capture Intents) -------------------------------------------------------------------------------------------------------------------------
  function captureElements() {
    let root = $('camera-capture');
    if (!root) {
      root = documentRef.createElement('div'); root.id = 'camera-capture'; root.className = 'cam-ui'; root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Câmera do dispositivo');
      root.innerHTML = '<canvas class="cam-ui-view" aria-label="Imagem da câmera"></canvas><p class="cam-ui-note" role="status"></p><div class="cam-ui-bar"><button type="button" class="cam-ui-side cam-ui-cancel">Cancelar</button><button type="button" class="cam-ui-shutter" aria-label="Tirar foto"></button><button type="button" class="cam-ui-side cam-ui-accept" hidden>Usar foto</button></div>';
      $('android-screen').append(root);
    }
    return { root, view: root.querySelector('.cam-ui-view'), note: root.querySelector('.cam-ui-note'), cancel: root.querySelector('.cam-ui-cancel'), shutter: root.querySelector('.cam-ui-shutter'), accept: root.querySelector('.cam-ui-accept') };
  }
  function drawCapture() { const { view } = captureElements(); source.drawUpright(view.getContext('2d'), 0, 0, view.width, view.height); }
  const interceptBack = event => { if (!S.capture) return; event.preventDefault(); event.stopImmediatePropagation(); finishCapture(false); };
  function openCapture(request) {
    if (S.capture) finishCapture(false);
    const ui = captureElements(), content = $('android-content'), layer = $('android-window-layer');
    const video = request.mode === 'video', size = video ? VIDEO_CAPTURE : CAPTURE_SIZE;
    S.capture = { id: request.id, stage: 'live', video, limitMs: video && request.durationLimit > 0 ? request.durationLimit * 1000 : 0, recording: null, movie: null, inertBefore: { content: content.inert, layer: layer.inert }, focusBack: documentRef.activeElement };
    ui.view.width = size.width; ui.view.height = size.height; content.inert = true; layer.inert = true;
    ui.root.setAttribute('aria-label', video ? 'Câmera do dispositivo: gravação de vídeo' : 'Câmera do dispositivo'); ui.accept.textContent = video ? 'Usar vídeo' : 'Usar foto';
    const setStage = (stage, problem = '') => {
      const capture = S.capture; capture.stage = stage; ui.accept.hidden = stage !== 'review'; ui.shutter.classList.toggle('review', stage === 'review'); ui.shutter.disabled = stage === 'finishing'; ui.cancel.disabled = stage === 'finishing';
      const origin = `Câmera do dispositivo virtual · ${source.kind === 'pattern' ? 'padrão de teste' : source.label}`;
      if (!video) { ui.shutter.setAttribute('aria-label', stage === 'review' ? 'Tirar outra foto' : 'Tirar foto'); ui.note.textContent = stage === 'review' ? 'Foto tirada. Use esta foto ou tire outra.' : origin; }
      else {
        ui.shutter.setAttribute('aria-label', stage === 'recording' ? 'Parar gravação' : stage === 'review' ? 'Gravar outro vídeo' : 'Gravar vídeo');
        ui.shutter.style.backgroundColor = stage === 'review' ? '' : '#e53935'; ui.shutter.style.borderRadius = stage === 'recording' ? '18px' : '';   // a red disc records, a red square stops
        ui.note.textContent = problem || (stage === 'recording' ? `Gravando · ${clock(0)}` : stage === 'finishing' ? 'Finalizando o vídeo…' : stage === 'review' ? `Vídeo gravado (${(capture.movie.durationMs / 1000).toFixed(1).replace('.', ',')} s, ${Math.round(capture.movie.bytes.length / 1024)} KiB). Use este vídeo ou grave outro.` : `${origin} · vídeo${capture.limitMs ? ` de até ${capture.limitMs / 1000} s` : ''}`);
      }
      if (stage === 'live' || stage === 'recording') wake(); if (stage !== 'finishing') (stage === 'review' ? ui.accept : ui.shutter).focus();
    };
    S.capture.setStage = setStage;
    ui.shutter.onclick = () => {
      const stage = S.capture.stage;
      if (video) { if (stage === 'live') startRecording(); else if (stage === 'recording') stopRecording(); else if (stage === 'review') { S.capture.movie = null; setStage('live'); } return; }
      if (stage === 'live') { source.advance(); drawCapture(); setStage('review'); } else setStage('live');   // the frame on screen at the click is the picture
    };
    ui.accept.onclick = () => finishCapture(true);
    ui.cancel.onclick = () => finishCapture(false);
    ui.root.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); finishCapture(false); } };
    $('back-button')?.addEventListener('click', interceptBack, true);
    ui.root.hidden = false; setStage('live'); drawCapture();
  }
  // ---- the camera screen's recorder: the frames of its own canvas through the page's encoder into an MP4 held in memory ------------------------------------------------------
  function startRecording() {
    const capture = S.capture, ui = captureElements(), codecs = S.codecs; if (!capture || !codecs) { capture?.setStage('live', 'Este navegador não tem um codificador de vídeo H.264 (WebCodecs).'); return; }
    const pieces = [], writer = createMp4Writer({ width: ui.view.width, height: ui.view.height, rotation: 0, write: (data, position) => pieces.push({ data: data.slice(), position }) });
    const recording = capture.recording = { writer, pieces, handle: null, startedAt: null, lastKeyUs: -Infinity, lastUs: -1, error: null };
    try {
      recording.handle = codecs.createVideoEncoder({ width: ui.view.width, height: ui.view.height, bitrate: VIDEO_CAPTURE.bitrate, frameRate: VIDEO_CAPTURE.frameRate, profile: codecs.videoEncoders[0].profiles[0] }, {
        output: chunk => { try { writer.addSample(splitAnnexB(chunk.data), { key: chunk.key, timestampUs: chunk.timestampUs }); } catch (error) { recording.error ??= error; } },
        error: message => { recording.error ??= new Error(message); } });
    } catch (error) { capture.recording = null; capture.setStage('live', `O codificador de vídeo não iniciou: ${String(error?.message ?? error)}`); return; }
    capture.setStage('recording');
  }
  /** One frame of the camera screen into the recording: what is on its canvas now, stamped with the time since the recording began. */
  function recordFrame(now) {
    const capture = S.capture, recording = capture?.recording; if (!recording) return;
    if (recording.error) { stopRecording(); return; }
    recording.startedAt ??= now; const elapsed = now - recording.startedAt, timestampUs = Math.max(recording.lastUs + 1, Math.round(elapsed * 1000)), key = timestampUs - recording.lastKeyUs >= 1e6;
    if (key) recording.lastKeyUs = timestampUs; recording.lastUs = timestampUs;
    const ui = captureElements();
    try { recording.handle.encode({ frame: new VideoFrame(ui.view, { timestamp: timestampUs }), timestampUs, key }); } catch (error) { recording.error ??= error; }
    ui.note.textContent = `Gravando · ${clock(elapsed)}${capture.limitMs ? ` de ${clock(capture.limitMs)}` : ''}`;
    if (capture.limitMs && elapsed >= capture.limitMs) stopRecording();   // MediaStore.EXTRA_DURATION_LIMIT
  }
  async function stopRecording() {
    const capture = S.capture, recording = capture?.recording; if (!recording || capture.stage !== 'recording') return;
    capture.setStage('finishing'); let problem = '';
    try {
      await recording.handle.flush(); if (recording.error) throw recording.error;
      recording.writer.finish();
      const bytes = new Uint8Array(recording.writer.size); for (const piece of recording.pieces) bytes.set(piece.data, piece.position);
      capture.movie = { bytes, durationMs: recording.writer.durationUs / 1000 };
    } catch (error) { problem = `A gravação falhou: ${String(error?.message ?? error)}`; }
    try { recording.handle.close(); } catch { /* already closed */ }
    if (S.capture !== capture) return;   // cancelled meanwhile
    capture.recording = null; capture.setStage(capture.movie ? 'review' : 'live', problem);
  }
  async function finishCapture(accepted) {
    const capture = S.capture; if (!capture || capture.finishing || capture.stage === 'finishing') return; capture.finishing = true;
    const ui = captureElements(); let message = { op: 'capture-result', id: capture.id, ok: false }, transfer = [];
    if (capture.recording) { try { capture.recording.handle.close(); } catch { /* already closed */ } capture.recording = null; }
    if (accepted && capture.video) { if (capture.movie) { const video = capture.movie.bytes.buffer; message = { op: 'capture-result', id: capture.id, ok: true, video }; transfer = [video]; } }
    else if (accepted) {
      try {
        const blob = await new Promise((resolve, reject) => ui.view.toBlob(value => (value ? resolve(value) : reject(new Error('o navegador não codificou o JPEG'))), 'image/jpeg', 0.92));
        const jpeg = await blob.arrayBuffer(), size = inlineThumbnailSize(ui.view.width, ui.view.height), small = Object.assign(documentRef.createElement('canvas'), size), ctx = small.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(ui.view, 0, 0, size.width, size.height);
        const thumb = { ...size, data: ctx.getImageData(0, 0, size.width, size.height).data.buffer };
        message = { op: 'capture-result', id: capture.id, ok: true, jpeg, thumb }; transfer = [jpeg, thumb.data];
      } catch { message = { op: 'capture-result', id: capture.id, ok: false }; }   // nothing to hand over: the app sees a cancelled capture
    }
    closeCapture(); post(message, transfer);
  }
  function closeCapture() {
    const capture = S.capture; if (!capture) return; S.capture = null;
    const ui = captureElements(), content = $('android-content'), layer = $('android-window-layer');
    if (capture.recording) { try { capture.recording.handle.close(); } catch { /* already closed */ } capture.recording = null; }
    ui.root.hidden = true; ui.shutter.onclick = ui.accept.onclick = ui.cancel.onclick = ui.root.onkeydown = null; ui.shutter.style.backgroundColor = ''; ui.shutter.style.borderRadius = ''; ui.shutter.disabled = false; ui.cancel.disabled = false;
    $('back-button')?.removeEventListener('click', interceptBack, true);
    content.inert = capture.inertBefore.content; layer.inert = capture.inertBefore.layer;
    try { capture.focusBack?.focus?.(); } catch { /* the element is gone */ }
  }

  // ---- the Worker's side -----------------------------------------------------------------------------------------------------------------------------------------------------
  vm.onCamera = message => {
    if (!message || typeof message !== 'object') return;
    if (message.op === 'open') S.opened.add(String(message.cameraId));
    else if (message.op === 'close') { S.opened.delete(String(message.cameraId)); S.streams.delete(String(message.cameraId)); }
    else if (message.op === 'streams') {
      const next = new Map();
      for (const entry of message.cameras ?? []) { const previous = S.streams.get(entry.id); next.set(entry.id, { active: !!entry.active, buffers: entry.buffers ?? [], once: entry.once ?? [], rotation: entry.rotation ?? 0, crop: entry.crop ?? null, served: previous?.served ?? new Set(), inFlight: previous?.inFlight ?? null, sentAt: previous?.sentAt ?? 0 }); }
      S.streams = next;
    } else if (message.op === 'ack') { const stream = S.streams.get(String(message.cameraId)); if (stream && stream.inFlight === message.seq) stream.inFlight = null; }
    else if (message.op === 'capture-ui') openCapture(message);
    else if (message.op === 'capture-ui-close') closeCapture();
    if (message.op !== 'ack') renderPanel();
    wake();
  };

  installPanel();
  return {
    source, bindSurface,
    get stats() { return { ...S.stats }; },
    /** A new VM was loaded: this page is its camera hardware and its camera app. Sent before any app code runs. */
    attach() { S.attached = true; S.opened.clear(); S.streams.clear(); S.surfaces.clear(); closeCapture(); post({ op: 'attach', captureUi: true, captureVideo: !!S.codecs }); installPanel(); renderPanel(); },
    detach() { S.attached = false; S.opened.clear(); S.streams.clear(); S.surfaces.clear(); closeCapture(); renderPanel(); },
    refresh: renderPanel,
  };
}
export { CAMERAS };
