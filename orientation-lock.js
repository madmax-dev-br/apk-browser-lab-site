// The Device section's Orientation select (src/index.html #dev-orientation) while the Activity on top fixes its orientation (android:screenOrientation in its manifest entry, or
// setRequestedOrientation at run time; the Worker snapshot's orientationLock, src/android-platform.js orientationLock). On a phone, turning the device changes nothing then, so
// the control is disabled and says why; it comes back when an Activity that rotates is on top, the app is in the background or no app runs. The device itself already
// follows the app's request (the effective device, src/device-state-host.js); the user's choice stays saved and applies again when the lock goes. No timer of its own.

const LABELS = { portrait: 'portrait', landscape: 'landscape' };

/** The control's state for a snapshot lock ({ request, name, orientation, activity, source } or null) (pure): { disabled, text, title }. */
export function orientationControlState(lock) {
  if (!lock || !lock.name) return { disabled: false, text: '', title: '' };
  const shown = LABELS[lock.orientation] ?? 'portrait';
  const how = lock.name === 'locked' ? `locked at ${shown}` : lock.name === 'nosensor' ? `no rotation (nosensor), stays ${shown}` : lock.name === shown ? shown : `${shown} (${lock.name})`;
  const where = lock.source === 'setRequestedOrientation' ? 'setRequestedOrientation' : 'android:screenOrientation';
  return {
    disabled: true,
    text: `Locked by the app: ${how}. Your choice applies again when an Activity that rotates is on top.`,
    title: `${lock.activity || 'The Activity on top'} asks for ${lock.name} (${where} ${lock.request})`,
  };
}

/** Wires the select and its status line: show(lock) after each snapshot, show(null) when no app runs. */
export function createOrientationLock({ $ }) {
  let last = null;
  const show = lock => {
    const select = $('dev-orientation'), note = $('dev-orientation-lock'); if (!select) return;
    const state = orientationControlState(lock), key = JSON.stringify(state); if (key === last) return; last = key;
    select.disabled = state.disabled; select.title = state.title;
    if (state.disabled) select.setAttribute('aria-describedby', 'dev-orientation-lock'); else select.removeAttribute('aria-describedby');
    if (note) { note.textContent = state.text; note.hidden = !state.disabled; }
  };
  return { show, reset: () => show(null) };
}
