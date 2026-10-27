import { createHostRegistry, floatBits } from './host-contract.js?v=4c3f3e1e13b1';
import { DIGESTS } from './crypto-host.js?v=4c3f3e1e13b1';

// android.provider.Settings.Secure / Global / System as an app (not a system app) sees them: reads of the keys a stock Android 13 device exposes, taken from the virtual device
// (font scale, animation scale, 24-hour clock, airplane mode follow the Dispositivo panel), ANDROID_ID derived per (package, device) like Android 8+'s per-app-signing-key value,
// SettingNotFoundException for a missing key in the no-default getters, and the SecurityException a third-party app gets for writes. Contract: Settings.java /
// SettingsProvider (android-13.0.0_r1).
const SETTINGS = 'Landroid/provider/Settings;', SECURE = 'Landroid/provider/Settings$Secure;', GLOBAL = 'Landroid/provider/Settings$Global;', SYSTEM = 'Landroid/provider/Settings$System;';
const RESOLVER = 'Landroid/content/ContentResolver;', STRING = 'Ljava/lang/String;', NOT_FOUND = 'Landroid/provider/Settings$SettingNotFoundException;', CONTEXT = 'Landroid/content/Context;';

export function createSettingsHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(SETTINGS, 'Ljava/lang/Object;'); for (const owner of [SECURE, SYSTEM]) type(owner, 'Ljava/lang/Object;');   // Settings.Global belongs to content-resolver-host (a writable VM store with observers)
  type('Landroid/util/AndroidException;', 'Ljava/lang/Exception;'); type(NOT_FOUND, 'Landroid/util/AndroidException;');
  def(NOT_FOUND, '<init>', `(${STRING})V`, (r, _m, [self, message]) => { r.object(self).message = message; }); def(NOT_FOUND, '<init>', '()V', () => {});
  const device = () => platform.device ?? {};
  const androidId = r => { const bytes = DIGESTS['SHA-256'].fn(new TextEncoder().encode(`apkweb-device:${platform.packageName ?? 'app'}`)); return Array.from(bytes.slice(0, 8), b => b.toString(16).padStart(2, '0')).join(''); };
  const tables = {
    [SECURE]: r => ({ android_id: androidId(r), accessibility_enabled: '0', touch_exploration_enabled: '0', speak_password: '0', high_text_contrast_enabled: '0', long_press_timeout: '400', multi_press_timeout: '300',
      default_input_method: 'com.android.inputmethod.latin/.LatinIME', location_mode: '3', location_providers_allowed: 'gps,network', skip_first_use_hints: '0', screensaver_enabled: '1', tts_default_rate: '100',
      show_ime_with_hard_keyboard: '0', user_setup_complete: '1', install_non_market_apps: '0', accessibility_display_magnification_enabled: '0', enabled_accessibility_services: null }),
    [GLOBAL]: r => ({ airplane_mode_on: '0', adb_enabled: '0', development_settings_enabled: '0', device_name: 'Browser Lab', device_provisioned: '1', auto_time: '1', auto_time_zone: '1',
      animator_duration_scale: String(device().animatorScale ?? 1), transition_animation_scale: String(device().animatorScale ?? 1), window_animation_scale: String(device().animatorScale ?? 1), always_finish_activities: '0',
      stay_on_while_plugged_in: '0', wifi_on: device().connectivity === 'offline' ? '0' : '1', bluetooth_on: '0', mobile_data: '1', data_roaming: '0', boot_count: '1', wait_for_debugger: '0', usb_mass_storage_enabled: '0',
      install_non_market_apps: '0', nfc_on: '0', airplane_mode_radios: 'cell,bluetooth,wifi,nfc,wimax', low_power: '0', zen_mode: '0', network_scoring_provisioned: '1' }),
    [SYSTEM]: r => ({ font_scale: String(device().fontScale ?? 1), time_12_24: device().hour24 ? '24' : '12', screen_brightness: '128', screen_brightness_mode: '1', screen_off_timeout: '60000', accelerometer_rotation: '1', user_rotation: '0',
      haptic_feedback_enabled: '1', sound_effects_enabled: '1', vibrate_when_ringing: '0', dtmf_tone: '1', lockscreen_sounds_enabled: '1', show_touches: '0', pointer_location: '0', end_button_behavior: '2', date_format: '', ringtone: null }),
  };
  const lookup = (r, owner, name) => { if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'name'); const table = tables[owner](r), key = r.stringCharacters(name); return Object.hasOwn(table, key) ? table[key] : null; };
  for (const owner of [SECURE, SYSTEM]) {
    def(owner, 'getString', `(${RESOLVER}${STRING})${STRING}`, (r, _m, [, name]) => lookup(r, owner, name), { static: true });
    def(owner, 'getStringForUser', `(${RESOLVER}${STRING}I)${STRING}`, (r, _m, [, name]) => lookup(r, owner, name), { static: true });
    const typed = (suffix, code, parse, wrap) => {
      def(owner, `get${suffix}`, `(${RESOLVER}${STRING}${code})${code}`, (r, _m, [, name, fallback]) => { const v = lookup(r, owner, name), n = v === null ? NaN : parse(v); return Number.isNaN(n) ? fallback : wrap(n); }, { static: true });
      def(owner, `get${suffix}`, `(${RESOLVER}${STRING})${code}`, (r, _m, [, name]) => { const v = lookup(r, owner, name), n = v === null ? NaN : parse(v); if (Number.isNaN(n)) r.throwJava(NOT_FOUND, r.stringCharacters(name)); return wrap(n); }, { static: true });
    };
    typed('Int', 'I', v => /^-?\d+$/.test(v) ? Number(v) | 0 : NaN, n => n);
    typed('Long', 'J', v => /^-?\d+$/.test(v) ? BigInt(v) : NaN, n => n);
    typed('Float', 'F', v => Number.isFinite(Number(v)) && v !== '' ? Number(v) : NaN, n => floatBits(n));
  }
  // writes by a third-party app are refused by SettingsProvider
  const denied = { [SECURE]: 'android.permission.WRITE_SECURE_SETTINGS', [GLOBAL]: 'android.permission.WRITE_SECURE_SETTINGS', [SYSTEM]: 'android.permission.WRITE_SETTINGS' };
  for (const owner of [SECURE, SYSTEM]) for (const [name, value] of [['putString', STRING], ['putInt', 'I'], ['putLong', 'J'], ['putFloat', 'F']]) def(owner, name, `(${RESOLVER}${STRING}${value})Z`, (r) => {
    r.throwJava('Ljava/lang/SecurityException;', owner === SYSTEM ? `You do not have permission to write system settings.` : `Permission denial: writing to settings requires:${denied[owner]}`);
  }, { static: true });
  def(SYSTEM, 'canWrite', `(${CONTEXT})Z`, () => 0, { static: true });
  def(SETTINGS, 'canDrawOverlays', `(${CONTEXT})Z`, () => 0, { static: true });
  // Settings.Global values live in content-resolver-host's writable store; these are the stock values it falls back to.
  const globalDefault = key => { const table = tables[GLOBAL](null); return Object.hasOwn(table, key) ? table[key] : undefined; };
  return { ...registry, interfaces: registry.interfacesOf, globalDefault };
}
