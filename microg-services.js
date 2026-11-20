// microG's online services the user can turn on (CLAUDE.md, owner's decision of 2026-11-20; docs/MICROG.md section 10). Pure data and checks, no VM: the page (Device panel,
// src/device-settings.js), the Worker and the device (src/microg-device.js) share them.
//
// Each service is off by default. Turned on (the Device panel's "microG services" group, or microG's own settings screens), the device writes microG's settings the way microG's
// own UI does (its preference helpers over SettingsContract / SettingsProvider) and microG's own code then talks to the service's hosts. Nothing here is a result: a token, a
// registration or a license only ever comes from microG's code and the real servers.

/**
 * The services, in the order the page lists them. `keys`: the SettingsContract keys microG's own switch writes; `setters`: the microG preference helpers its settings screen calls
 * (class, static method or the Kotlin companion's, and the value written), in order; `hosts`: who it talks to (for the page and the docs; the device's allow list still decides).
 */
export const MICROG_SERVICES = Object.freeze([
  Object.freeze({ id: 'checkin', label: 'Device registration', who: 'Google', hosts: Object.freeze(['android.clients.google.com']),
    what: 'Registers this virtual device with Google (check-in: an HTTPS POST to android.clients.google.com/checkin with the device data microG reports, its "native" profile: the device\'s own Build values). Google answers an Android ID and a security token; push needs them.',
    keys: Object.freeze(['checkin_enable_service']), setters: Object.freeze([{ owner: 'org.microg.gms.checkin.CheckinPreferences', name: 'setEnabled' }]) }),
  Object.freeze({ id: 'gcm', label: 'Cloud messaging', who: 'Google', hosts: Object.freeze(['android.clients.google.com', 'mtalk.google.com:5228', 'mtalk.google.com:443']), needs: 'checkin',
    what: 'Push (GCM/FCM): microG registers each app that asks for a token (android.clients.google.com/c2dm/register3) and keeps a TLS connection to mtalk.google.com:5228 for incoming messages. In the browser that connection needs the APK Lab Relay as the Proxy (its TCP tunnel). Needs Device registration.',
    keys: Object.freeze(['gcm_enable_mcs_service']), setters: Object.freeze([{ owner: 'org.microg.gms.gcm.GcmPrefs', companion: true, name: 'setEnabled' }]) }),
  Object.freeze({ id: 'attestation', label: 'Device attestation', who: 'Google', hosts: Object.freeze(['www.googleapis.com', 'play-fe.googleapis.com']),
    what: 'SafetyNet and Play Integrity through DroidGuard, embedded mode only (DroidGuard\'s code comes from Google). Turns on microG\'s SafetyNet and DroidGuard switches, as microG\'s screen does.',
    keys: Object.freeze(['safetynet_enabled', 'droidguard_enabled']), setters: Object.freeze([{ owner: 'org.microg.gms.safetynet.SafetyNetPreferences', name: 'setEnabled' }, { owner: 'org.microg.gms.droidguard.core.DroidGuardPreferences', name: 'setEnabled' }]) }),
  Object.freeze({ id: 'licensing', label: 'Licensing', who: 'Google', hosts: Object.freeze(['play-fe.googleapis.com']),
    what: 'Play licensing (LVL): microG\'s Play Store asks Google whether the app is licensed to the signed-in Google account. Without an account microG answers nothing and posts a sign-in notification.',
    keys: Object.freeze(['vending_licensing']), setters: Object.freeze([{ owner: 'org.microg.gms.vending.VendingPreferences', name: 'setLicensingEnabled' }]) }),
  Object.freeze({ id: 'billing', label: 'Billing', who: 'Google', hosts: Object.freeze(['play-fe.googleapis.com']),
    what: 'Play billing: microG\'s Play Store answers the Billing Library; purchases need a signed-in Google account (without one microG answers "No Google account found.").',
    keys: Object.freeze(['vending_billing']), setters: Object.freeze([{ owner: 'org.microg.gms.vending.VendingPreferences', name: 'setBillingEnabled' }]) }),
  Object.freeze({ id: 'location', label: 'Online location', who: 'BeaconDB and OpenStreetMap', hosts: Object.freeze(['api.beacondb.net', 'nominatim.openstreetmap.org']),
    what: 'microG\'s online location source (BeaconDB, from the Wi-Fi access points and cell towers the device sees) and its geocoder (OpenStreetMap Nominatim). Not Google. Contribution of location data stays off.',
    keys: Object.freeze(['location_wifi_mls', 'location_cell_mls', 'location_geocoder_nominatim']),
    setters: Object.freeze([{ owner: 'org.microg.gms.location.LocationSettings', instance: true, name: 'setWifiIchnaea' }, { owner: 'org.microg.gms.location.LocationSettings', instance: true, name: 'setCellIchnaea' }, { owner: 'org.microg.gms.location.LocationSettings', instance: true, name: 'setGeocoderNominatim' }]) }),
]);
export const MICROG_SERVICE_IDS = Object.freeze(MICROG_SERVICES.map(service => service.id));
/** Every service off: the default, and what a missing or malformed setting becomes. */
export const MICROG_SERVICES_OFF = Object.freeze(Object.fromEntries(MICROG_SERVICE_IDS.map(id => [id, false])));
/** The page's setting: { checkin, gcm, attestation, licensing, billing, location }, each true only when it is exactly true. */
export function sanitizeMicrogServices(input) {
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(MICROG_SERVICE_IDS.map(id => [id, source[id] === true]));
}
export const microgService = id => MICROG_SERVICES.find(service => service.id === id) ?? null;

/**
 * microG's data-donation and telemetry switches: off and never offered (CLAUDE.md "No telemetry"). The device's ROM-defaults file pins them off and the device refuses any write that
 * would turn one on, whoever writes it (microG's screens, its ProvisionService, its own code).
 */
export const MICROG_NO_TELEMETRY_KEYS = Object.freeze(['location_ichnaea_contribute', 'vending_device_sync', 'allow_upload_game_played', 'exposure_scanner_enabled']);

/**
 * microG's ROM-defaults file (/system/etc/microg.xml): only what the device keeps fixed. Every other setting starts at microG's own code default (all off,
 * play-services-base/core/.../SettingsProvider.kt) and can be changed. `device_profile` native: microG's copy of android.os.Build is the device's own values (no built-in or spoofed
 * profile); `droidguard_mode` Embedded: a remote DroidGuard server would attest another device.
 */
export const MICROG_ROM_DEFAULTS = Object.freeze({ device_profile: 'native', droidguard_mode: 'Embedded', location_ichnaea_contribute: false, vending_device_sync: false, allow_upload_game_played: false, exposure_scanner_enabled: false });

const truthy = value => value === true || value === 1 || value === '1' || value === 'true';
const blank = value => value === null || value === undefined || value === '';
/**
 * Why the device refuses a write of microG setting `key` = `value` (a string), or null when it may be written. The fixed settings: the no-telemetry switches (never on), the device
 * profile (only "native"), DroidGuard's mode (only Embedded) and its network server (never set). The serial microG keeps for its native profile (device_profile_serial) is microG's
 * own random value (ProfileManager.randomSerial: the native profile never reports the device's serial) and is left to it.
 */
export function microgSettingRefusal(key, value) {
  if (MICROG_NO_TELEMETRY_KEYS.includes(key)) return truthy(value) ? 'microG\'s data-donation and telemetry switches stay off on this device (no telemetry of anyone but the app\'s own)' : null;
  if (key === 'device_profile') return blank(value) || value === 'native' ? null : 'microG\'s device profile stays "native" (the device\'s own Build values; no built-in or spoofed profile)';
  if (key === 'droidguard_mode') return blank(value) || value === 'Embedded' ? null : 'DroidGuard runs embedded only: a remote DroidGuard server would attest another device';
  if (key === 'droidguard_network_server_url') return blank(value) ? null : 'DroidGuard runs embedded only: no remote DroidGuard server';
  return null;
}
/** The service a microG setting key belongs to, or null. */
export const serviceOfKey = key => MICROG_SERVICES.find(service => service.keys.includes(key)) ?? null;
