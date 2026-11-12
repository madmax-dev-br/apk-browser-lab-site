// What the virtual device's cameras look at (page side, DOM): a generated test feed, the computer's webcam (getUserMedia), a still image or a video file. One scene feeds both
// cameras; nothing here leaves the page (frames go to canvases of this document and, for ImageReader targets, to the VM Worker of this page).
//
// The scene is "upright": what a person holding the phone in portrait sees through the lens. `drawUpright` paints it into any rectangle (the generated feed draws for the exact
// aspect; a webcam, image or video is centre-cropped to it, as a phone's portrait view of that picture would be). `drawSensor` paints the same scene the way the sensor of a camera
// delivers it: landscape, turned so that rotating the buffer CameraCharacteristics.SENSOR_ORIENTATION degrees clockwise makes it upright (src/camera-frames.js).
export const SOURCE_KINDS = Object.freeze(['pattern', 'webcam', 'image', 'video']);
const BARS = ['#ebebeb', '#ebeb10', '#10ebeb', '#10eb10', '#eb10eb', '#eb1010', '#1010eb', '#101010'];
const two = n => String(n).padStart(2, '0');

/** The generated feed: colour bars, a grid, a disc that moves, a sweeping line, a wall clock with milliseconds and a frame counter. Everything depends on `timeMs` / `frame`, so two captures differ visibly. */
export function drawTestPattern(ctx, width, height, timeMs, frame) {
  const barHeight = Math.round(height * 0.42);
  for (let i = 0; i < 8; i++) { ctx.fillStyle = BARS[i]; ctx.fillRect(Math.floor(i * width / 8), 0, Math.ceil(width / 8), barHeight); }
  const gradient = ctx.createLinearGradient(0, 0, width, 0); gradient.addColorStop(0, '#000'); gradient.addColorStop(1, '#fff'); ctx.fillStyle = gradient; ctx.fillRect(0, barHeight, width, Math.round(height * 0.06));
  ctx.fillStyle = '#16202e'; ctx.fillRect(0, barHeight + Math.round(height * 0.06), width, height);
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = Math.max(1, width / 480); ctx.beginPath();
  const step = width / 8; for (let x = step; x < width; x += step) { ctx.moveTo(x, barHeight); ctx.lineTo(x, height); } for (let y = barHeight + step; y < height; y += step) { ctx.moveTo(0, y); ctx.lineTo(width, y); } ctx.stroke();
  const phase = timeMs / 1000, radius = width * 0.07, cx = width / 2 + Math.cos(phase * 1.7) * (width / 2 - radius * 1.3), cy = height * 0.74 + Math.sin(phase * 2.3) * (height * 0.2 - radius);
  ctx.fillStyle = '#ff8a00'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx - radius * 0.3, cy - radius * 0.3, radius * 0.25, 0, Math.PI * 2); ctx.fill();
  const sweep = ((timeMs % 4000) / 4000) * width; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillRect(sweep, barHeight, Math.max(2, width / 240), height - barHeight);
  const now = new Date(), clock = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  const big = Math.round(width * 0.105), small = Math.round(width * 0.055);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(width * 0.06, height * 0.5, width * 0.88, big * 2.5);
  ctx.fillStyle = '#fff'; ctx.font = `700 ${big}px ui-monospace, Menlo, monospace`; ctx.fillText(clock, width / 2, height * 0.5 + big * 0.75);
  ctx.font = `600 ${small}px ui-monospace, Menlo, monospace`; ctx.fillStyle = '#ffd54a'; ctx.fillText(`quadro ${frame}`, width / 2, height * 0.5 + big * 1.85);
  ctx.font = `600 ${Math.round(small * 0.8)}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.textBaseline = 'bottom'; ctx.fillText('↑ CÂMERA DE TESTE', width / 2, height * 0.975);
}

export function createCameraSource({ onChange = () => {}, documentRef = globalThis.document, mediaDevices = globalThis.navigator?.mediaDevices } = {}) {
  const S = { kind: 'pattern', label: 'Padrão de teste gerado', error: '', stream: null, video: null, image: null, objectURL: null, frame: 0, started: performance.now() };
  const release = () => {
    if (S.stream) for (const track of S.stream.getTracks()) track.stop();
    if (S.video) { S.video.pause(); S.video.srcObject = null; S.video.removeAttribute('src'); S.video.load?.(); }
    if (S.objectURL) URL.revokeObjectURL(S.objectURL);
    S.stream = null; S.video = null; S.image = null; S.objectURL = null;
  };
  const usePattern = (error = '') => { release(); S.kind = 'pattern'; S.label = 'Padrão de teste gerado'; S.error = error; onChange(); };
  const videoElement = () => { const video = documentRef.createElement('video'); video.muted = true; video.playsInline = true; video.loop = true; return video; };
  /** The picture element and its intrinsic size, or null while it has nothing to show (the generated feed stands in). */
  const picture = () => {
    if (S.kind === 'image' && S.image) return { element: S.image, width: S.image.naturalWidth || S.image.width, height: S.image.naturalHeight || S.image.height };
    if ((S.kind === 'webcam' || S.kind === 'video') && S.video && S.video.readyState >= 2 && S.video.videoWidth > 0) return { element: S.video, width: S.video.videoWidth, height: S.video.videoHeight };
    return null;
  };
  const api = {
    get kind() { return S.kind; }, get label() { return S.label; }, get error() { return S.error; }, get frame() { return S.frame; },
    /** Size of the picture the source delivers (null for the generated feed, which has no size of its own). */
    get size() { const p = picture(); return p ? { width: p.width, height: p.height } : null; },
    /** One tick of the frame loop: the counter the generated feed shows. */
    advance() { S.frame++; },
    /**
     * Switches the source. 'webcam' asks the browser for the camera here and only here (its own permission prompt); 'image' / 'video' take a File. A source that cannot start leaves
     * the generated feed selected and `error` says why. Resolves to the kind in effect.
     */
    async select(kind, file = null) {
      if (kind === 'pattern') { usePattern(); return S.kind; }
      try {
        if (kind === 'webcam') {
          if (!mediaDevices?.getUserMedia) throw new Error('este navegador não oferece getUserMedia nesta página (é preciso HTTPS ou localhost)');
          const stream = await mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          release(); S.stream = stream; S.video = videoElement(); S.video.srcObject = stream; await S.video.play();
          for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (S.stream === stream) usePattern('a webcam foi desligada; a câmera voltou ao padrão de teste'); });
          S.kind = 'webcam'; S.label = stream.getVideoTracks()[0]?.label || 'Webcam'; S.error = '';
        } else if (kind === 'image') {
          if (!file) throw new Error('nenhum arquivo de imagem escolhido');
          const url = URL.createObjectURL(file), image = new Image(); image.src = url;
          try { await image.decode(); } catch { URL.revokeObjectURL(url); throw new Error(`o navegador não conseguiu abrir "${file.name}" como imagem`); }
          release(); S.objectURL = url; S.image = image; S.kind = 'image'; S.label = file.name; S.error = '';
        } else if (kind === 'video') {
          if (!file) throw new Error('nenhum arquivo de vídeo escolhido');
          const url = URL.createObjectURL(file), video = videoElement(); video.src = url;
          try { await video.play(); } catch { URL.revokeObjectURL(url); throw new Error(`o navegador não conseguiu reproduzir "${file.name}" como vídeo`); }
          release(); S.objectURL = url; S.video = video; S.kind = 'video'; S.label = file.name; S.error = '';
        } else throw new Error(`fonte desconhecida: ${kind}`);
        onChange(); return S.kind;
      } catch (error) {
        const reason = error?.name === 'NotAllowedError' ? 'a permissão da câmera foi negada no navegador' : error?.name === 'NotFoundError' ? 'nenhuma webcam foi encontrada neste computador' : error?.name === 'NotReadableError' ? 'a webcam está em uso por outro programa' : String(error?.message ?? error);
        usePattern(`${reason}; a câmera continua no padrão de teste`); return S.kind;
      }
    },
    /** The upright scene into (x, y, width, height) of `ctx`. `mirror`: flipped left to right (how a front camera's preview is shown). */
    drawUpright(ctx, x, y, width, height, { mirror = false } = {}) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip(); ctx.translate(x, y);
      if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1); }
      const p = picture();
      if (!p) drawTestPattern(ctx, width, height, performance.now() - S.started, S.frame);
      else { const scale = Math.max(width / p.width, height / p.height), sw = width / scale, sh = height / scale; ctx.drawImage(p.element, (p.width - sw) / 2, (p.height - sh) / 2, sw, sh, 0, 0, width, height); }
      ctx.restore();
    },
    /** The scene as the sensor of a camera mounted at `orientation` (90 back, 270 front) delivers it: a width x height landscape buffer. */
    drawSensor(ctx, width, height, orientation) {
      ctx.save();
      if (orientation === 90) { ctx.translate(0, height); ctx.rotate(-Math.PI / 2); api.drawUpright(ctx, 0, 0, height, width); }
      else if (orientation === 270) { ctx.translate(width, 0); ctx.rotate(Math.PI / 2); api.drawUpright(ctx, 0, 0, height, width); }
      else if (orientation === 180) { ctx.translate(width, height); ctx.rotate(Math.PI); api.drawUpright(ctx, 0, 0, width, height); }
      else api.drawUpright(ctx, 0, 0, width, height);
      ctx.restore();
    },
    dispose() { release(); },
  };
  return api;
}
