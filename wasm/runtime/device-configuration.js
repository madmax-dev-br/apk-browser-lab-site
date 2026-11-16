// android.content.res.Configuration / DisplayMetrics values of the virtual device, derived from one place (the device profile + system-bar sizes).
// Used for the initial Configuration, live changes (ActivityThread.handleConfigurationChanged semantics) and as the resource-selector profile.
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'iw']);
export function screenLayoutFor(widthDp, heightDp, locale) {
  const shortSide = Math.min(widthDp, heightDp), longSide = Math.max(widthDp, heightDp);
  const size = shortSide >= 720 && longSide >= 960 ? 4 : shortSide >= 480 && longSide >= 640 ? 3 : shortSide >= 320 && longSide >= 470 ? 2 : 1;
  const long = longSide / shortSide >= 1.668 ? 0x20 : 0x10, layoutDir = RTL_LANGUAGES.has(String(locale).split('-')[0]) ? 0x80 : 0x40;
  return size | long | layoutDir;
}
/** `insets` = {top,bottom,left,right} dp of the current system bars (the app-visible area excludes them, as Configuration.screenWidthDp/HeightDp do). */
export function configurationFor(device, insets = { top: 0, bottom: 0, left: 0, right: 0 }) {
  const widthDp = Math.round(device.widthDp - insets.left - insets.right), heightDp = Math.round(device.heightDp - insets.top - insets.bottom);
  const [language, region = ''] = device.locale.split('-');
  return { densityDpi: 160, screenWidthDp: widthDp, screenHeightDp: heightDp, smallestScreenWidthDp: Math.min(widthDp, heightDp, device.widthDp, device.heightDp),
    orientation: device.orientation === 'landscape' ? 2 : 1, uiMode: device.darkTheme ? 0x21 : 0x11, screenLayout: screenLayoutFor(widthDp, heightDp, device.locale), fontScale: device.fontScale, language, region, locale: device.locale };
}
/** ResourceConfigProvider profile (original ResTable_config matching) for the same device state. */
export function resourceProfileFor(device, insets) {
  const value = configurationFor(device, insets), [language, region] = [value.language, value.region || 'US'];
  return { sdkVersion: 28, density: value.densityDpi, widthDp: value.screenWidthDp, heightDp: value.screenHeightDp, smallestWidthDp: value.smallestScreenWidthDp, orientation: value.orientation, uiMode: value.uiMode, screenLayout: value.screenLayout, language, region };
}
