// The "microG services" group of the Device section (src/index.html #dev-microg-services): one switch per online service of microG (src/microg-services.js), each off by default,
// each saying plainly who it talks to. The choice is a device setting (src/device-settings.js microgServices, saved with the others); it reaches the device at the next load and,
// while an APK runs with microG, at once (vm.setMicrogServices): the device then flips microG's own switch the way microG's settings screen does. The status line shows microG's
// switches as the device last saw them written (a change made in microG's own screens shows there too). No timer of its own.

import { MICROG_SERVICES, sanitizeMicrogServices } from './microg-services.js?v=5376509d4366';

/** The plain-language line of one service: who it talks to and what for (pure). */
export function microgServiceText(service) {
  return `Talks to ${service.who} (${service.hosts.join(', ')}). ${service.what} Off by default; saved with the device settings and recorded in the trace.`;
}
/** The status line under the group (pure): what the user chose, what microG has, and why a choice does nothing yet. */
export function microgServicesStatus({ chosen, microgOn, loadedMicrog, effective = null }) {
  const on = MICROG_SERVICES.filter(service => chosen?.[service.id]).map(service => service.label);
  if (!microgOn) return { state: on.length ? 'warn' : 'off', text: on.length ? `Chosen: ${on.join(', ')}; they apply with "With microG" on.` : 'All off (microG\'s defaults). They apply with "With microG" on.' };
  const needsCheckin = chosen?.gcm && !chosen?.checkin ? ' Cloud messaging needs Device registration: without it microG refuses push registration ("Checkin disabled").' : '';
  if (!effective) return { state: on.length ? 'on' : 'off', text: `${on.length ? `On: ${on.join(', ')}` : 'All off (microG\'s defaults)'}.${loadedMicrog === false ? ' Reopen the APK to apply (it runs without microG).' : ''}${needsCheckin}` };
  const inMicrog = MICROG_SERVICES.filter(service => effective[service.id]).map(service => service.label);
  return { state: inMicrog.length ? 'on' : 'off', text: `In microG now: ${inMicrog.length ? inMicrog.join(', ') : 'all off'}.${needsCheckin}` };
}

export function createMicrogServicesPanel({ $, onChange }) {
  const list = () => $('dev-microg-service-list');
  const box = $('dev-microg-service-list');
  if (box) box.replaceChildren(...MICROG_SERVICES.flatMap(service => {
    const id = `dev-microg-service-${service.id}`;
    const label = document.createElement('label'); label.htmlFor = id; label.textContent = service.label;
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = id; input.dataset.service = service.id; input.setAttribute('aria-describedby', `${id}-note`);
    const note = document.createElement('p'); note.id = `${id}-note`; note.className = 'cp-note cp-microg-service-note'; note.textContent = microgServiceText(service);
    input.addEventListener('change', () => onChange(read()));
    return [label, input, note];
  }));
  const read = () => sanitizeMicrogServices(Object.fromEntries(MICROG_SERVICES.map(service => [service.id, list()?.querySelector?.(`[data-service="${service.id}"]`)?.checked === true])));
  let last = { chosen: null, microgOn: false, loadedMicrog: undefined, effective: null };
  const show = () => { const note = $('dev-microg-services-status'); if (!note) return; const { state, text } = microgServicesStatus(last); note.textContent = text; note.dataset.state = state === 'warn' ? 'warn' : state === 'on' ? 'ok' : ''; };
  return {
    read,
    /** The saved setting into the switches. */
    write(settings) {
      const chosen = sanitizeMicrogServices(settings?.microgServices);
      for (const service of MICROG_SERVICES) { const input = list()?.querySelector?.(`[data-service="${service.id}"]`); if (input) input.checked = chosen[service.id]; }
      last = { ...last, chosen, microgOn: settings?.microg === true }; show();
    },
    /** What the running device reports (snapshot deviceOptions.microg.services), or null without microG; `loadedMicrog`: whether the open APK runs with it. */
    update(services, loadedMicrog) { last = { ...last, effective: services?.effective ?? null, loadedMicrog }; show(); },
  };
}
