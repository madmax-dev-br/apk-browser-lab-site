// What an app gets from the device's microG (the "With microG" option, docs/MICROG.md section 9): one row per Play services API, with the state the probe
// (fixtures/play-services-probe.apk, tests/microg-option.test.mjs) checks on both engines. The page lists these rows in the Device section; the docs table follows the same list.
//   works  : microG answers locally, as on a phone with this microG
//   stub   : microG answers but does not implement it (or never answers); the device records it (DEVICE microG UNIMPLEMENTED, deviceOptions.microg.failures)
//   fails  : ends in an explicit failure naming what is missing (native code the device cannot run, or a microG screen the device does not open)
//   online : microG talks to a server for it once the user turns it on ("microG services", docs/MICROG.md section 10); off by microG's default it refuses explicitly
export const MICROG_APIS = Object.freeze([
  { api: 'Availability (GoogleApiAvailability, makeGooglePlayServicesAvailable)', state: 'works', note: 'SUCCESS: microG and its Play Store with the fake-signature certificate' },
  { api: 'App Set ID', state: 'works', note: 'a local UUID, scope app' },
  { api: 'Advertising ID', state: 'works', note: 'the all-zero id: microG limits ad tracking by default' },
  { api: 'Fused location: last, current, updates (callback and PendingIntent), removal, availability', state: 'works', note: 'the simulated position (Controls › App), changes delivered as they happen' },
  { api: 'Location settings check (SettingsClient.checkLocationSettings)', state: 'works', note: 'gps and network usable while device location is on; a resolution would open microG\'s own screen (refused)' },
  { api: 'SMS Retriever', state: 'works', note: 'an incoming SMS (Controls › App) that carries the app\'s hash reaches the app' },
  { api: 'SMS User Consent', state: 'works', note: 'the consent Intent reaches the app; its prompt is a microG Activity, which the device does not open (explicit failure)' },
  { api: 'Block Store (store, retrieve, delete)', state: 'works', note: 'local storage; end-to-end encryption answers false' },
  { api: 'Phenotype flags, Clearcut, client telemetry', state: 'works', note: 'empty configurations; events are discarded locally, as microG does' },
  { api: 'GServices provider', state: 'works', note: 'the local database, empty without device registration' },
  { api: 'Barcode scanning (Vision and ML Kit, from a Bitmap)', state: 'works', note: 'microG\'s pure-Java ZXing decoder' },
  { api: 'ModuleInstall', state: 'stub', note: 'microG answers "available" for any module and installs nothing' },
  { api: 'Thread network credentials', state: 'stub', note: 'microG answers empty / not found' },
  { api: 'Geofencing', state: 'stub', note: 'microG never answers addGeofences: the Task stays pending' },
  { api: 'Activity recognition, Sleep API, mock location, flushLocations', state: 'stub', note: 'microG answers SUCCESS and delivers nothing (flush never answers)' },
  { api: 'ProviderInstaller (security provider)', state: 'fails', note: 'returns without installing: microG\'s Conscrypt needs its ARM native library' },
  { api: 'Push (FCM token, topics, incoming messages), device registration (check-in)', state: 'online', note: 'off by default: SERVICE_NOT_AVAILABLE ("Checkin disabled"); with Device registration and Cloud messaging on, microG registers with Google and the token reaches the app; incoming messages need the APK Lab Relay as the Proxy' },
  { api: 'SafetyNet, Play Integrity, DroidGuard', state: 'online', note: 'off by default: explicit errors; Device attestation turns microG\'s switches on; DroidGuard\'s downloaded code is not loaded by the device' },
  { api: 'Licensing, billing', state: 'online', note: 'off by default (no license answer; billing unavailable); turned on, they need a Google account, which cannot sign in yet ("No Google account found.")' },
  { api: 'Google account sign-in', state: 'fails', note: 'microG\'s login screen does not open (Activities of a second package)' },
  { api: 'Face detection, document scanner, maps, Cronet', state: 'fails', note: 'need native code (OpenCV, VTM, Cronet) the device cannot run' },
]);
export const MICROG_API_STATE_LABELS = Object.freeze({ works: 'works', stub: 'microG stub', fails: 'explicit failure', online: 'needs a server (off by default)' });
