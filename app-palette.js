// The page in the colours of the app that is open: the brand colour is read from the app's launcher icon (the icon the VM answers through PackageManager), and the page's
// tokens (lab-tokens.css: accent, paper, lines) are derived from it for the light and the dark page theme, with the accent kept at a readable contrast (WCAG 4.5:1 against
// the surface it sits on). The change is a circular reveal from the device (View Transitions) where the browser has it and motion is not reduced; otherwise it is immediate.
// A grey or monochrome icon leaves the page as it is. It is always on: the old "Page in the app's colors" switch was removed on 2026-11-21. Nothing of the app's
// screen changes: only the page around the device.

/** The vivid colour that covers most of an RGBA image (alpha >= 200, saturation >= 0.3, lightness 0.15..0.85), as [r, g, b]; null when the image has almost none (a grey icon). */
export function dominantColor(rgba) {
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0 })); let opaque = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 200) continue; opaque++;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], [h, s, l] = hsl(r, g, b);
    if (s < 0.3 || l < 0.15 || l > 0.85) continue;
    const bin = bins[Math.floor(h * 24) % 24], weight = s * (1 - Math.abs(l - 0.5));
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
  }
  let best = null; for (const bin of bins) if (bin.weight > (best?.weight ?? 0)) best = bin;
  if (!best || !opaque || best.weight < opaque * 0.03) return null;
  return [best.r / best.weight, best.g / best.weight, best.b / best.weight].map(Math.round);
}

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, Math.min(1, s), l];
}
function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2, k = Math.floor(h * 6) % 6;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k];
  return [r + m, g + m, b + m].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
}
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const luminance = ([r, g, b]) => { const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
/** WCAG contrast ratio of two colours. */
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/**
 * The page tokens for a brand colour [r, g, b]: { light: { '--accent': '#...', ... }, dark: { ... } }. The accent keeps the brand's hue and is darkened (light theme) or lightened
 * (dark theme) until it reads at 4.5:1 on the surface; paper, lines and soft fills take the hue at low saturation.
 */
export function paletteFor(color) {
  const [h, s0] = hsl(...color), s = Math.min(0.9, Math.max(0.45, s0));
  const fit = (surface, from, step) => { let l = from; while (l > 0.05 && l < 0.95 && contrast(rgb(h, s, l), surface) < 4.5) l += step; return l; };
  const lightSurface = [255, 255, 255], lightL = fit(lightSurface, Math.min(0.5, hsl(...color)[2]), -0.01);
  const darkSurface = rgb(h, 0.3, 0.12), darkL = fit(darkSurface, Math.max(0.6, hsl(...color)[2]), 0.01);
  const light = {
    '--accent': hex(rgb(h, s, lightL)), '--accent-ink': hex(rgb(h, s, lightL)), '--accent-hover': hex(rgb(h, s, Math.max(0.1, lightL - 0.07))), '--accent-soft': hex(rgb(h, 0.7, 0.94)), '--on-accent': '#FFFFFF',
    '--bg': hex(rgb(h, 0.25, 0.965)), '--surface': '#FFFFFF', '--surface-2': hex(rgb(h, 0.25, 0.98)), '--line': hex(rgb(h, 0.22, 0.87)), '--line-strong': hex(rgb(h, 0.18, 0.74)),
    '--grid': hex(rgb(h, 0.22, 0.87)), '--code-bg': hex(rgb(h, 0.22, 0.93)), '--lane-vm': hex(rgb(h, s, lightL)), '--lane-vm-soft': hex(rgb(h, 0.7, 0.94)), '--syn-keyword': hex(rgb(h, s, lightL)),
  };
  const dark = {
    '--accent': hex(rgb(h, s, darkL)), '--accent-ink': hex(rgb(h, s, Math.min(0.9, darkL + 0.08))), '--accent-hover': hex(rgb(h, s, Math.min(0.92, darkL + 0.06))), '--accent-soft': hex(rgb(h, 0.4, 0.18)), '--on-accent': hex(rgb(h, 0.4, 0.08)),
    '--bg': hex(rgb(h, 0.35, 0.08)), '--surface': hex(darkSurface), '--surface-2': hex(rgb(h, 0.28, 0.15)), '--line': hex(rgb(h, 0.25, 0.2)), '--line-strong': hex(rgb(h, 0.22, 0.34)),
    '--grid': hex(rgb(h, 0.25, 0.2)), '--code-bg': hex(rgb(h, 0.28, 0.15)), '--lane-vm': hex(rgb(h, s, darkL)), '--lane-vm-soft': hex(rgb(h, 0.4, 0.18)), '--syn-keyword': hex(rgb(h, s, Math.min(0.9, darkL + 0.08))),
  };
  return { light, dark, color: hex(color) };
}

const STORAGE_KEY = 'apkweb-app-palette';
/** The CSS of a palette: `:root:root` outranks lab-tokens.css' `:root` and `:root[data-theme=dark]` rules. */
export const paletteCSS = palette => `:root:root{${Object.entries(palette.light).map(([k, v]) => `${k}:${v}`).join(';')}}\n:root:root[data-theme=dark]{${Object.entries(palette.dark).map(([k, v]) => `${k}:${v}`).join(';')}}`;

/**
 * doc: the page document. toggle: the checkbox of the option. origin(): the element the reveal starts from (the device screen). Returns { fromIcon(icon), clear(), state }.
 */
export function createAppPalette({ doc = globalThis.document, toggle = null, origin = () => null } = {}) {
  const S = { enabled: true, palette: null, color: null, pending: 0 };
  // Always on (owner, 2026-11-21): the page takes the open app's colours and is neutral with no app; there is no option to turn it off. A stored 'off' from the old switch is dropped.
  try { globalThis.localStorage?.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
  if (toggle) toggle.checked = true;
  const style = doc.createElement('style'); style.id = 'app-palette'; doc.head.append(style);
  const reduced = () => { try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const write = css => { style.textContent = css; doc.documentElement.dataset.appPalette = css ? 'on' : 'off'; };
  const show = css => {
    if (style.textContent === css) return;
    if (typeof doc.startViewTransition !== 'function' || reduced()) { write(css); return; }
    const box = origin()?.getBoundingClientRect?.(), view = doc.defaultView ?? globalThis;
    const x = box ? box.left + box.width / 2 : view.innerWidth / 2, y = box ? box.top + box.height / 2 : view.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, view.innerWidth - x), Math.max(y, view.innerHeight - y));
    const transition = doc.startViewTransition(() => write(css));
    transition.ready.then(() => doc.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 900, easing: 'cubic-bezier(.2,.75,.15,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  };
  const apply = () => show(S.enabled && S.palette ? paletteCSS(S.palette) : '');
  toggle?.addEventListener('change', () => { S.enabled = !!toggle.checked; try { globalThis.localStorage?.setItem(STORAGE_KEY, S.enabled ? 'on' : 'off'); } catch { /* not kept */ } apply(); });
  return {
    state: S,
    /** The app's launcher icon ({ bytes, mime }): its brand colour becomes the page's palette (a grey icon keeps the page's own). */
    async fromIcon(icon) {
      const token = ++S.pending;
      if (!icon?.bytes) return;
      let color = null;
      try {
        const bitmap = await createImageBitmap(new Blob([icon.bytes], { type: icon.mime || 'image/png' })), size = 48;
        const canvas = new OffscreenCanvas(size, size), ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0, size, size); bitmap.close?.();
        color = dominantColor(ctx.getImageData(0, 0, size, size).data);
      } catch (error) { color = null; S.error = String(error?.message ?? error); }
      if (token !== S.pending) return;
      S.color = color; S.palette = color ? paletteFor(color) : null; apply();
    },
    /** The icon the launcher shows (an object URL: the VM's answer, or the copy kept with the saved app). */
    async fromURL(url) {
      if (!url) return this.clear();
      const token = ++S.pending; let blob = null; try { blob = await (await fetch(url)).blob(); } catch { blob = null; }
      if (token !== S.pending) return;
      return blob ? this.fromIcon({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type }) : undefined;   // an icon URL revoked meanwhile (a newer icon replaced it): the newer one decides
    },
    /** No app: the page's own palette. */
    clear() { S.pending++; S.color = null; S.palette = null; apply(); },
  };
}
