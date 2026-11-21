// "Add Google account (microG)" in the Device panel's "microG services" group (src/index.html, src/app.js): Settings > Accounts > Add account for a Google account, done by the device
// (src/account-sessions.js addAccountFromSettings): microG's authenticator answers with its login screen, which opens on the device. Pure, so tests read the same text the page shows.

/** Whether the action can be used: an open APK that runs with microG, Device registration on (microG signs in a registered device: its LoginActivity checks in first), the VM idle. */
export const canAddGoogleAccount = ({ busy = false, running = false, loadedMicrog = false, checkin = false } = {}) => !busy && running && loadedMicrog === true && checkin === true;

/** The status line under the button. `relay`: whether the device's Proxy is set (the sign-in page needs the relay); `outcome`: the last answer ({ ok, accountName, error }) or null. */
export function googleAccountText({ running = false, loadedMicrog = false, checkin = false, relay = false, pending = false, outcome = null } = {}) {
  if (!running || !loadedMicrog) return 'Open an APK with "With microG" on to add a Google account to microG.';
  if (!checkin) return 'Turn on Device registration first: microG signs in only on a registered device.';
  if (pending) return 'microG\'s sign-in screen is open on the device: type your Google email and password into Google\'s page there.';
  if (outcome?.ok) return `Google account added to microG: ${outcome.accountName}. It is kept with microG's data on this device (Clear microG data removes it).`;
  if (outcome && !outcome.ok) return outcome.error === 'canceled' ? 'Sign-in canceled in microG\'s screen.' : `The account was not added: ${outcome.error ?? 'microG did not answer with an account'}.`;
  return relay ? 'Opens microG\'s sign-in screen on the device.' : 'Start the APK Lab Relay on this computer first (the lab finds it by itself; Device > Proxy shows it): Google\'s sign-in page loads on the device only through it.';
}
