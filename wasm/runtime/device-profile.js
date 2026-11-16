// Virtual device model shared by the page (device frame, settings panel) and the VM (display metrics, Configuration, system-bar insets).
// Sizes are dp at the VM's density (160 dpi: 1 dp = 1 px). System-bar heights are NOT constants here: the VM reads status_bar_height,
// navigation_bar_height from the framework resource table; only values the framework does not define are listed (gesture inset).
export const SCREEN_PRESETS = Object.freeze([
  { id: 'phone', label: 'Telefone · 411 × 914 dp', widthDp: 411, heightDp: 914 },
  { id: 'compact', label: 'Compacto · 360 × 800 dp', widthDp: 360, heightDp: 800 },
  { id: 'large', label: 'Grande · 412 × 892 dp', widthDp: 412, heightDp: 892 },
  { id: 'small', label: 'Pequeno · 320 × 640 dp', widthDp: 320, heightDp: 640 },
  { id: 'tablet', label: 'Tablet · 800 × 1280 dp', widthDp: 800, heightDp: 1280 },
]);
/** dp -> px factor of the VM display (densityDpi 160: 1 dp = 1 px). A custom screen typed in px is converted with it, so the VM always gets dp at this density. */
export const SCREEN_DENSITY = 1;
/** "Personalizado": bounds of each side of a custom screen, in device pixels. */
export const CUSTOM_SCREEN_LIMITS = Object.freeze({ minPx: 120, maxPx: 4096 });
export const DEFAULT_CUSTOM_SCREEN = Object.freeze({ width: 411, height: 914, unit: 'dp' });
/**
 * A custom screen { width, height, unit: 'dp' | 'px' } checked and converted: { value, widthDp, heightDp, widthPx, heightPx } or { error } (a Portuguese message for the panel).
 * px = dp x density; each side must be a whole number and land between CUSTOM_SCREEN_LIMITS in px. Width and height are the portrait sides: resolveDevice puts the
 * shorter side across in portrait and the longer one across in landscape, as it does for the presets.
 */
export function checkCustomScreen(input, density = SCREEN_DENSITY) {
  if (!input || typeof input !== 'object') return { error: 'Informe largura e altura.' };
  const unit = input.unit === undefined ? 'dp' : input.unit;
  if (unit !== 'dp' && unit !== 'px') return { error: 'Unidade inválida: use dp ou px.' };
  const read = value => (typeof value === 'number' || (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) ? Number(value) : NaN);
  const width = read(input.width), height = read(input.height);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return { error: 'Informe largura e altura em números inteiros.' };
  const { minPx, maxPx } = CUSTOM_SCREEN_LIMITS, toPx = value => (unit === 'px' ? value : Math.round(value * density)), toDp = value => (unit === 'dp' ? value : Math.round(value / density));
  const widthPx = toPx(width), heightPx = toPx(height);
  if (widthPx < minPx || widthPx > maxPx || heightPx < minPx || heightPx > maxPx) {
    const range = unit === 'px' || density === 1 ? `${minPx} e ${maxPx} ${unit}` : `${Math.ceil(minPx / density)} e ${Math.floor(maxPx / density)} dp (${minPx} a ${maxPx} px com densidade ${density})`;
    return { error: `Cada lado precisa ter entre ${range}.` };
  }
  return { value: Object.freeze({ width, height, unit }), widthDp: toDp(width), heightDp: toDp(height), widthPx, heightPx };
}
export const DEFAULT_DEVICE = Object.freeze({
  screen: 'phone', customScreen: DEFAULT_CUSTOM_SCREEN, orientation: 'portrait', fontScale: 1, locale: 'en-US', darkTheme: false, hour24: true, timeZone: '', animatorScale: 1,
  battery: { level: 80, charging: false }, connectivity: 'online', navigation: 'gesture', statusBarHeightDp: null,
  // Network policy of the virtual device: hosts the app may reach through fetch (empty = none: the device behaves as if offline for every name) and an optional relay URL.
  network: Object.freeze({ allowedHosts: Object.freeze([]), proxyUrl: '', hostMap: Object.freeze([]) }),
});
/** Gesture-navigation bottom inset of the reference device (Pixel, API 36): the framework only defines the 3-button bar height. */
export const GESTURE_NAVIGATION_INSET_DP = 24;
export function resolveDevice(settings = {}) {
  const device = { ...DEFAULT_DEVICE, ...settings, battery: { ...DEFAULT_DEVICE.battery, ...(settings.battery || {}) } };
  const custom = device.screen === 'custom' ? checkCustomScreen(device.customScreen) : null;   // "Personalizado": the same path as a preset, in dp at SCREEN_DENSITY; an invalid one falls back to the first preset
  const preset = custom?.value ? { widthDp: Math.min(custom.widthDp, custom.heightDp), heightDp: Math.max(custom.widthDp, custom.heightDp) } : SCREEN_PRESETS.find(value => value.id === device.screen) ?? SCREEN_PRESETS[0], landscape = device.orientation === 'landscape';
  device.widthDp = landscape ? preset.heightDp : preset.widthDp; device.heightDp = landscape ? preset.widthDp : preset.heightDp;
  if (custom?.value) device.customScreen = custom.value; else { device.customScreen = DEFAULT_CUSTOM_SCREEN; if (device.screen === 'custom') device.screen = SCREEN_PRESETS[0].id; }
  device.network = Object.freeze({ allowedHosts: Object.freeze([...(device.network?.allowedHosts ?? [])]), proxyUrl: device.network?.proxyUrl ?? '', hostMap: Object.freeze((device.network?.hostMap ?? []).map(rule => Object.freeze({ ...rule }))) });
  device.fontScale = Math.min(2, Math.max(0.85, Number(device.fontScale) || 1)); device.animatorScale = Math.min(10, Math.max(0, Number.isFinite(Number(device.animatorScale)) ? Number(device.animatorScale) : 1));
  return Object.freeze(device);
}
