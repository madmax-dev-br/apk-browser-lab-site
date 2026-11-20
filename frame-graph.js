// "Show frame rate": draws the FrameMeter (src/frame-meter.js) over the device screen, in the spirit of Android's "Profile HWUI rendering > On screen as bars": one stacked bar per frame
// with the green 16.67 ms line, and a realtime FPS line with its current / average / minimum values and the count of janky frames. A page canvas: it takes no input, it is not part of the
// app's pixels and the screenshots plugins take never include it. Pure drawing over a 2D context; no DOM besides the canvas it is given, no process.*.
import { FRAME_STAGES, FRAME_BUDGET_MS, SAMPLES_KEPT, SAMPLE_MS, BAR_FRAMES } from './frame-meter.js?v=230d3f53d504';

const GREEN = '#38d65a', AMBER = '#f5a623', RED = '#ff5252', TEXT = '#f2f4f7', DIM = '#9aa3af', PANEL = 'rgba(14,17,22,0.9)';
const MARGIN = 4, PAD = 6, SCALE = 2;   // the bitmap is drawn at twice the layout size: the screen is often scaled to fit the page
const FONT = size => `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** The tallest value the bars are scaled to: at least three budgets, more when a frame needs it (capped: a very long frame is cut with a white tip). */
export function barScale(bars, cap = 6 * FRAME_BUDGET_MS) {
  let max = 3 * FRAME_BUDGET_MS; for (const bar of bars) if (bar.work > max) max = bar.work;
  return Math.min(cap, Math.ceil(max / 10) * 10);
}
/** The FPS axis: 0 to the next multiple of 30 above the largest sample, never below 60. */
export function fpsScale(samples) {
  let max = 60; for (const sample of samples) if (sample.fps !== null && sample.fps > max) max = sample.fps;
  return Math.ceil(max / 30) * 30;
}
/** The one-line text of the FPS header, as drawn (kept apart so tests read the same words). */
export function summaryLines(summary) {
  const fps = value => value === null || value === undefined ? '-' : String(Math.round(value));
  return [
    summary.idle ? 'FPS  idle: nothing to draw' : `FPS ${fps(summary.currentFps)}  avg ${fps(summary.averageFps)}  min ${fps(summary.minFps)}`,
    `janky >16.7 ms: ${summary.jankyOver16}   >33 ms: ${summary.jankyOver33}   frames: ${summary.frames}`,
  ];
}

/** Draws both panels on `canvas` (CSS size width x height); `top` keeps them under the status bar. */
export function drawFrameGraph(canvas, meter, { width, height, top = 28, at = meter.now() } = {}) {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  if (canvas.width !== w * SCALE) canvas.width = w * SCALE; if (canvas.height !== h * SCALE) canvas.height = h * SCALE;
  const ctx = canvas.getContext('2d'); ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); ctx.clearRect(0, 0, w, h);
  const summary = meter.summary(at), innerW = w - 2 * MARGIN;
  // ---- the FPS panel ----
  const fpsH = 74; let y = top;
  ctx.fillStyle = PANEL; ctx.fillRect(MARGIN, y, innerW, fpsH);
  const [line1, line2] = summaryLines(summary);
  ctx.font = FONT(10); ctx.textBaseline = 'top'; ctx.fillStyle = summary.idle ? DIM : TEXT; ctx.fillText(line1, MARGIN + PAD, y + 4);
  ctx.fillStyle = summary.jankyOver33 ? RED : summary.jankyOver16 ? AMBER : DIM; ctx.fillText(line2, MARGIN + PAD, y + 17);
  const plot = { left: MARGIN + PAD, right: MARGIN + innerW - PAD, top: y + 32, bottom: y + fpsH - 6 }, axis = fpsScale(meter.samples), plotH = plot.bottom - plot.top, plotW = plot.right - plot.left;
  const yFps = value => plot.bottom - Math.min(1, value / axis) * plotH, xAt = index => plot.right - (meter.samples.length - 1 - index) * (plotW / (SAMPLES_KEPT - 1));
  ctx.strokeStyle = 'rgba(56,214,90,0.55)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(plot.left, yFps(60)); ctx.lineTo(plot.right, yFps(60)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = DIM; ctx.font = FONT(8); ctx.fillText('60', plot.left, yFps(60) - 9); ctx.fillText(`${Math.round(SAMPLES_KEPT * SAMPLE_MS / 1000)} s`, plot.left, plot.bottom - 9);
  // idle samples are a gray band (nothing to draw: not 0 fps); the line breaks there
  ctx.fillStyle = 'rgba(154,163,175,0.22)';
  meter.samples.forEach((sample, index) => { if (sample.fps === null) ctx.fillRect(xAt(index) - plotW / SAMPLES_KEPT / 2, plot.top, plotW / SAMPLES_KEPT, plotH); });
  ctx.strokeStyle = TEXT; ctx.lineWidth = 1.5; ctx.beginPath(); let open = false;
  meter.samples.forEach((sample, index) => { if (sample.fps === null) { open = false; return; } const x = xAt(index), yy = yFps(sample.fps); if (open) ctx.lineTo(x, yy); else { ctx.moveTo(x, yy); open = true; } });
  ctx.stroke();
  if (open) { const last = meter.samples.length - 1; ctx.fillStyle = TEXT; ctx.beginPath(); ctx.arc(xAt(last), yFps(meter.samples[last].fps), 2, 0, Math.PI * 2); ctx.fill(); }
  // ---- the bars panel ----
  y += fpsH + 4; const barsH = 100;
  ctx.fillStyle = PANEL; ctx.fillRect(MARGIN, y, innerW, barsH);
  ctx.font = FONT(8); ctx.textBaseline = 'top'; let x = MARGIN + PAD;   // legend
  for (const stage of FRAME_STAGES) { ctx.fillStyle = stage.color; ctx.fillRect(x, y + 5, 7, 7); ctx.fillStyle = TEXT; ctx.fillText(stage.label, x + 10, y + 4); x += 12 + ctx.measureText(stage.label).width + 5; }
  const bars = { left: MARGIN + PAD, right: MARGIN + innerW - PAD, top: y + 20, bottom: y + barsH - 10 }, barsPlotH = bars.bottom - bars.top, max = barScale(meter.frames), scale = barsPlotH / max;
  const slot = (bars.right - bars.left) / BAR_FRAMES, barW = Math.max(1, slot - 0.5), burstGap = 3;
  let cursor = bars.right;   // newest on the right; a burst boundary leaves a gap (the screen was idle in between)
  for (let i = meter.frames.length - 1; i >= 0; i--) {
    const bar = meter.frames[i]; cursor -= slot; if (cursor < bars.left - slot) break;
    let top2 = bars.bottom;
    for (const stage of FRAME_STAGES) { const value = bar[stage.key]; if (!value) continue; const hh = Math.min(value * scale, top2 - bars.top); ctx.fillStyle = stage.color; ctx.fillRect(cursor, top2 - hh, barW, hh); top2 -= hh; }
    if (bar.work > max) { ctx.fillStyle = '#fff'; ctx.fillRect(cursor, bars.top, barW, 2); }
    ctx.fillStyle = bar.slow ? RED : bar.janky ? AMBER : 'rgba(56,214,90,0.7)'; ctx.fillRect(cursor, bars.bottom + 2, barW, 3);   // the frame time (the interval between two frames, or the frame's own work first in a burst)
    if (bar.burstStart) cursor -= burstGap;
  }
  const yBudget = bars.bottom - FRAME_BUDGET_MS * scale;
  ctx.strokeStyle = GREEN; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bars.left, yBudget); ctx.lineTo(bars.right, yBudget); ctx.stroke();
  ctx.fillStyle = GREEN; ctx.font = FONT(8); ctx.fillText('16.7 ms', bars.left, yBudget - 9);
  if (!meter.frames.length) { ctx.fillStyle = DIM; ctx.fillText('no frame drawn yet', bars.left, bars.top + 14); }
}
