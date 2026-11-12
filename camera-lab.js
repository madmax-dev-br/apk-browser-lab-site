// The page side of the virtual device's cameras: the "Câmera" section of the Controles panel (which source the cameras look at), the frame loop that feeds the VM, the camera
// stream drawn inside TextureView / SurfaceView elements of the device, and the system camera screen that answers the capture Intents. The Android side is src/camera-host.js.
//
// Cost model. Nothing runs while no app uses the camera (and the section is closed). A preview is drawn by the page straight into the View's element: the Worker gets one small
// message per frame (no pixels) and answers with an ack; a new frame is only sent after the previous one was acknowledged. Pixels cross to the Worker only for ImageReader targets:
// one RGBA buffer per frame at the reader's size (read back from a small 2D canvas, transferred, not copied), and one buffer once for a still capture.
import { createCameraSource } from './camera-source.js?v=a9e9656b8d6c';
import { CAMERAS, cameraById, LENS_FACING_FRONT, inlineThumbnailSize } from './camera-frames.js?v=a9e9656b8d6c';

const FRAME_MS = 1000 / 30, MONITOR_MS = 200, ACK_TIMEOUT_MS = 1500;
const CAPTURE_SIZE = { width: 960, height: 1280 };   // the upright picture the system camera screen takes (3:4)
const facingName = camera => (camera.facing === LENS_FACING_FRONT ? 'frontal' : 'traseira');

export function createCameraLab({ $, vm, documentRef = globalThis.document }) {
  const S = { attached: false, opened: new Set(), streams: new Map(), surfaces: new Set(), capture: null, timer: null, lastTick: 0, lastMonitor: 0, seq: 0, readers: new Map(),
    stats: { frames: 0, pixelFrames: 0, pixelBytes: 0, readbackMs: 0, drawMs: 0, windowStart: 0, windowFrames: 0, fps: 0 } };
  const source = createCameraSource({ onChange: () => { renderPanel(); wake(); } });
  const post = (message, transfer) => vm.cameraMessage?.(message, transfer);

  // ---- the panel -------------------------------------------------------------------------------------------------------------------------------------------------------------
  const sectionOpen = () => !!$('cp-sec-camera')?.open;
  function statusText() {
    const parts = [];
    if (!S.attached) parts.push('Nenhum APK aberto: o dispositivo ganha as câmeras 0 (traseira) e 1 (frontal) quando um APK é aberto.');
    else if (!S.opened.size) parts.push('Nenhum app com a câmera aberta: nenhum quadro é gerado para a VM.');
    else for (const id of S.opened) {
      const camera = cameraById(id), stream = S.streams.get(id), pixels = stream?.buffers?.length ? `, ${stream.buffers.map(b => `${b.width}×${b.height}`).join(' e ')} em pixels para o app` : ', prévia desenhada pela página (sem pixels para a VM)';
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
    const width = stream.height, height = stream.width;   // the buffer is landscape; shown upright it is height x width, stretched to the View's box as the consumer does
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    source.drawUpright(canvas.getContext('2d'), 0, 0, width, height, { mirror: stream.facing === LENS_FACING_FRONT });
  }
  function readerCanvas(width, height) {
    const key = `${width}x${height}`; let entry = S.readers.get(key);
    if (!entry) { const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : Object.assign(documentRef.createElement('canvas'), { width, height }); entry = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) }; S.readers.set(key, entry); }
    return entry;
  }
  /** One sensor buffer of `camera`: RGBA, width x height, in sensor orientation. */
  function sensorBuffer(camera, width, height) {
    const started = performance.now(), { ctx } = readerCanvas(width, height); source.drawSensor(ctx, width, height, camera.orientation);
    const data = ctx.getImageData(0, 0, width, height).data.buffer; S.stats.readbackMs += performance.now() - started; S.stats.pixelFrames++; S.stats.pixelBytes += data.byteLength; return data;
  }
  function sendFrame(id, stream, now) {
    const camera = cameraById(id); if (!camera) return;
    const buffers = stream.buffers.map(({ width, height }) => ({ width, height, data: sensorBuffer(camera, width, height) }));
    for (const once of stream.once) if (!stream.served.has(once.id)) { stream.served.add(once.id); buffers.push({ width: once.width, height: once.height, once: once.id, data: sensorBuffer(camera, once.width, once.height) }); }
    stream.inFlight = ++S.seq; stream.sentAt = now; S.stats.frames++; S.stats.windowFrames++;
    post({ op: 'frame', cameraId: id, seq: stream.inFlight, buffers }, buffers.map(buffer => buffer.data));
  }

  // ---- the frame loop --------------------------------------------------------------------------------------------------------------------------------------------------------
  const liveSurfaces = () => { for (const element of [...S.surfaces]) if (!element.isConnected) S.surfaces.delete(element); return [...S.surfaces].filter(element => element._cameraInfo?.stream?.live); };
  const needed = () => S.capture?.stage === 'live' || [...S.streams.values()].some(stream => stream.active) || liveSurfaces().length > 0 || sectionOpen();
  function wake() { if (S.timer === null && needed()) schedule(); }
  function schedule() { S.timer = documentRef.visibilityState === 'visible' && typeof requestAnimationFrame === 'function' ? { raf: requestAnimationFrame(tick) } : { timeout: setTimeout(() => tick(performance.now()), 100) }; }
  function tick(now) {
    S.timer = null; if (!needed()) { renderPanel(); return; }
    const streaming = S.capture?.stage === 'live' || [...S.streams.values()].some(stream => stream.active) || liveSurfaces().length > 0;
    if (streaming && now - S.lastTick >= FRAME_MS - 3) {
      S.lastTick = now; source.advance(); const started = performance.now();
      for (const element of liveSurfaces()) drawSurface(element);
      if (S.capture?.stage === 'live') drawCapture();
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
    S.capture = { id: request.id, stage: 'live', inertBefore: { content: content.inert, layer: layer.inert }, focusBack: documentRef.activeElement };
    ui.view.width = CAPTURE_SIZE.width; ui.view.height = CAPTURE_SIZE.height; content.inert = true; layer.inert = true;
    const setStage = stage => {
      S.capture.stage = stage; ui.accept.hidden = stage !== 'review'; ui.shutter.setAttribute('aria-label', stage === 'review' ? 'Tirar outra foto' : 'Tirar foto'); ui.shutter.classList.toggle('review', stage === 'review');
      ui.note.textContent = stage === 'review' ? 'Foto tirada. Use esta foto ou tire outra.' : `Câmera do dispositivo virtual · ${source.kind === 'pattern' ? 'padrão de teste' : source.label}`;
      if (stage === 'live') wake(); (stage === 'review' ? ui.accept : ui.shutter).focus();
    };
    ui.shutter.onclick = () => { if (S.capture.stage === 'live') { source.advance(); drawCapture(); setStage('review'); } else setStage('live'); };   // the frame on screen at the click is the picture
    ui.accept.onclick = () => finishCapture(true);
    ui.cancel.onclick = () => finishCapture(false);
    ui.root.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); finishCapture(false); } };
    $('back-button')?.addEventListener('click', interceptBack, true);
    ui.root.hidden = false; setStage('live'); drawCapture();
  }
  async function finishCapture(accepted) {
    const capture = S.capture; if (!capture || capture.finishing) return; capture.finishing = true;
    const ui = captureElements(); let message = { op: 'capture-result', id: capture.id, ok: false }, transfer = [];
    if (accepted) {
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
    ui.root.hidden = true; ui.shutter.onclick = ui.accept.onclick = ui.cancel.onclick = ui.root.onkeydown = null;
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
      for (const entry of message.cameras ?? []) { const previous = S.streams.get(entry.id); next.set(entry.id, { active: !!entry.active, buffers: entry.buffers ?? [], once: entry.once ?? [], served: previous?.served ?? new Set(), inFlight: previous?.inFlight ?? null, sentAt: previous?.sentAt ?? 0 }); }
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
    attach() { S.attached = true; S.opened.clear(); S.streams.clear(); S.surfaces.clear(); closeCapture(); post({ op: 'attach', captureUi: true }); installPanel(); renderPanel(); },
    detach() { S.attached = false; S.opened.clear(); S.streams.clear(); S.surfaces.clear(); closeCapture(); renderPanel(); },
    refresh: renderPanel,
  };
}
export { CAMERAS };
