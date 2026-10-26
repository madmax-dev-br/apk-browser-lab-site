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
export const DEFAULT_DEVICE = Object.freeze({
  screen: 'phone', orientation: 'portrait', fontScale: 1, locale: 'en-US', darkTheme: false, hour24: true, timeZone: '', animatorScale: 1,
  battery: { level: 80, charging: false }, connectivity: 'online', navigation: 'gesture', statusBarHeightDp: null,
  // Network policy of the virtual device: hosts the app may reach through fetch (empty = none: the device behaves as if offline for every name) and an optional relay URL.
  network: Object.freeze({ allowedHosts: Object.freeze([]), proxyUrl: '' }),
});
/** Gesture-navigation bottom inset of the reference device (Pixel, API 36): the framework only defines the 3-button bar height. */
export const GESTURE_NAVIGATION_INSET_DP = 24;
export function resolveDevice(settings = {}) {
  const device = { ...DEFAULT_DEVICE, ...settings, battery: { ...DEFAULT_DEVICE.battery, ...(settings.battery || {}) } };
  const preset = SCREEN_PRESETS.find(value => value.id === device.screen) ?? SCREEN_PRESETS[0], landscape = device.orientation === 'landscape';
  device.widthDp = landscape ? preset.heightDp : preset.widthDp; device.heightDp = landscape ? preset.widthDp : preset.heightDp;
  device.network = Object.freeze({ allowedHosts: Object.freeze([...(device.network?.allowedHosts ?? [])]), proxyUrl: device.network?.proxyUrl ?? '' });
  device.fontScale = Math.min(2, Math.max(0.85, Number(device.fontScale) || 1)); device.animatorScale = Math.min(10, Math.max(0, Number.isFinite(Number(device.animatorScale)) ? Number(device.animatorScale) : 1));
  return Object.freeze(device);
}
