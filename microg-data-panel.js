// "microG data" in the Device panel's "With microG" box: the status line of microG's stored device data (src/app-data-store.js attachDeviceData: data of the device, shared by every
// app run with the option on) and when "Clear microG data" may be used. Pure, so tests read the same text the page shows.

const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
const totals = list => list.reduce((sum, item) => ({ bytes: sum.bytes + (item.bytes ?? 0), files: sum.files + (item.files ?? 0) }), { bytes: 0, files: 0 });

/**
 * The status line. `statuses`: one per package ({ packageName, enabled, reason, bytes, files, restoredFiles, error, overLimit, cleared }), or null when the open APK does not run with
 * microG; `loadedMicrog`: whether it does.
 */
export function microgDataText(statuses, { loadedMicrog = false } = {}) {
  if (!loadedMicrog) return 'microG data: open an APK with "With microG" on to see what is stored (its device registration, accounts, settings and databases).';
  const list = Array.isArray(statuses) ? statuses : [];
  if (!list.length) return 'microG data: persistence is unavailable in this browser (no storage).';
  const { bytes, files } = totals(list), stored = files ? `${size(bytes)} · ${files} file(s)` : 'nothing stored';
  if (list.some(item => item.cleared)) return `microG data cleared: ${stored} · this run keeps what microG has in memory until the APK is reopened.`;
  if (list.every(item => item.enabled === false && item.reason === 'disabled')) return `microG data is not kept in this run ("Keep app data between reloads" is off) · stored: ${stored}.`;
  const failed = list.find(item => item.error), over = list.find(item => item.overLimit);
  if (failed) return `microG data: error while saving ${failed.packageName} (${failed.error}) · ${stored}.`;
  if (over) return `microG data of ${over.packageName} is over the limit: the write was refused and the last saved state was kept · ${stored}.`;
  const restored = list.reduce((sum, item) => sum + (item.restoredFiles ?? 0), 0);
  return `microG data kept on this device (shared by every app opened with microG): ${stored}${restored ? ` · ${restored} restored at this load` : ''}.`;
}

/** Whether "Clear microG data" can be pressed: an open APK that runs with microG, and the VM not busy. */
export const canClearMicrogData = ({ busy = false, running = false, loadedMicrog = false } = {}) => !busy && running && loadedMicrog === true;
