// Zoom of the device on the stage ("−  70%  +" at the top right of the stage). By default the device is fitted to the stage (capped at 70%, as before); a zoom chosen here
// is an absolute scale (100% = one CSS pixel per dp) that the stage scrolls around when it is larger than the stage. Only the CSS scale changes (device-view.js fitDevice):
// the VM keeps its size and density. Fullscreen always fits. The choice is kept per viewer in localStorage (every access guarded).
export const ZOOM_STEPS = Object.freeze([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2]);
const KEY = 'apkweb-device-zoom';

/** Pure: the next zoom step from the scale shown now, in a direction (+1 / -1); null means "fit". */
export function nextZoom(current, direction) {
  if (direction > 0) return ZOOM_STEPS.find(step => step > current + 0.001) ?? ZOOM_STEPS.at(-1);
  return [...ZOOM_STEPS].reverse().find(step => step < current - 0.001) ?? ZOOM_STEPS[0];
}
export function readZoom(storage = globalThis.localStorage) { try { const value = Number(storage?.getItem(KEY)); return ZOOM_STEPS.includes(value) ? value : null; } catch { return null; } }
export function writeZoom(value, storage = globalThis.localStorage) { try { if (value === null) storage?.removeItem(KEY); else storage?.setItem(KEY, String(value)); } catch { /* the zoom lasts for this page */ } }

/** The control. `deviceState.zoom` is what fitDevice reads; `refit()` applies it; `shownScale()` is the scale on screen now. */
export function createDeviceZoom({ stage, deviceState, refit, shownScale, doc = globalThis.document }) {
  if (!stage || typeof doc?.createElement !== 'function' || typeof stage.parentElement?.insertBefore !== 'function') return { sync() {} };   // no full DOM (a test sandbox): no control
  const box = doc.createElement('div'); box.className = 'stage-zoom'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Zoom do dispositivo');
  const button = (text, label) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label); b.title = label; box.append(b); return b; };
  const out = button('−', 'Diminuir o dispositivo'), value = button('Ajustar', 'Ajustar ao espaço'), into = button('+', 'Aumentar o dispositivo');
  stage.parentElement?.insertBefore(box, stage);
  deviceState.zoom = readZoom();
  // Keeps the point at the centre of what is visible where it was when the zoom changes (the device grows or shrinks around what you were looking at).
  const apply = zoom => {
    const cx = (stage.scrollLeft + stage.clientWidth / 2) / Math.max(1, stage.scrollWidth), cy = (stage.scrollTop + stage.clientHeight / 2) / Math.max(1, stage.scrollHeight);
    deviceState.zoom = zoom; writeZoom(zoom); refit(); sync();
    stage.scrollLeft = cx * stage.scrollWidth - stage.clientWidth / 2; stage.scrollTop = cy * stage.scrollHeight - stage.clientHeight / 2;
  };
  // Middle-button drag moves the device around the stage when it is larger than the stage (over the device too: the middle button never reaches the app). Wheel and the
  // scrollbars scroll the stage as usual outside the device; over the device the wheel belongs to the app.
  let pan = null;
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 1 || (stage.scrollWidth <= stage.clientWidth && stage.scrollHeight <= stage.clientHeight)) return;
    event.preventDefault(); event.stopPropagation();   // no browser auto-scroll, no tap for the app
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.dataset.panning = 'true';
    try { stage.setPointerCapture(event.pointerId); } catch { /* released already */ }
  }, true);
  stage.addEventListener('pointermove', event => { if (!pan || event.pointerId !== pan.id) return; event.preventDefault(); event.stopPropagation(); stage.scrollLeft = pan.left - (event.clientX - pan.x); stage.scrollTop = pan.top - (event.clientY - pan.y); }, true);
  const end = event => { if (!pan || event.pointerId !== pan.id) return; event.stopPropagation(); pan = null; delete stage.dataset.panning; try { stage.releasePointerCapture(event.pointerId); } catch { /* gone */ } };
  stage.addEventListener('pointerup', end, true); stage.addEventListener('pointercancel', end, true);
  stage.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); }, true);   // Windows/Linux middle-click auto-scroll
  stage.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); event.stopPropagation(); } }, true);
  out.addEventListener('click', () => apply(nextZoom(shownScale(), -1)));
  into.addEventListener('click', () => apply(nextZoom(shownScale(), +1)));
  value.addEventListener('click', () => apply(null));
  function sync() {
    const scale = shownScale(), fitted = deviceState.zoom === null || deviceState.zoom === undefined;
    value.textContent = `${Math.round(scale * 100)}%`; value.title = fitted ? 'Ajustado ao espaço' : 'Voltar a ajustar ao espaço'; value.setAttribute('aria-pressed', String(fitted));
    out.disabled = scale <= ZOOM_STEPS[0] + 0.001; into.disabled = scale >= ZOOM_STEPS.at(-1) - 0.001;
    if (fitted) delete stage.dataset.zoomed; else stage.dataset.zoomed = 'true';
    box.style.top = `${stage.offsetTop + 12}px`;   // over the stage's top right corner, outside its scrolling content
  }
  sync();
  return { sync };
}
