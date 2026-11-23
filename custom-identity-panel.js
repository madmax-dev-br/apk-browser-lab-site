// "Custom device identity" block of Controls › Device (CLAUDE.md, owner decision of 2026-11-21): off by default, the fields empty; the user types the product names and the
// next load applies them (src/device-identity.js customIdentityFor, src/apk-loader.js). The lab never fills the fields in: each placeholder shows the lab's own value,
// the one an empty field keeps. Each field's error shows under it; an identity with an error is not applied (the lab's applies) and the status line says so.
import { CUSTOM_IDENTITY_FIELDS, IDENTITY_PROPERTIES, checkCustomIdentity, customIdentityFor, customIdentityFieldsText } from './device-identity.js?v=7467c4d87e1f';

/** What the status line of the block says (pure): { state: 'off' | 'empty' | 'error' | 'on', text }. `checked`: checkCustomIdentity(...). */
export function customIdentityStatus(checked) {
  const typed = CUSTOM_IDENTITY_FIELDS.filter(field => checked.fields[field.key]).length, wrong = Object.keys(checked.errors).length;
  if (!checked.on) return { state: 'off', text: `Off: the device has the lab's identity.${typed ? ' The names typed stay here for when you turn it on.' : ''}` };
  if (wrong) return { state: 'error', text: `Not applied: ${wrong === 1 ? 'one field has' : `${wrong} fields have`} an error (shown under ${wrong === 1 ? 'it' : 'each'}). Until it is fixed the device has the lab's identity.` };
  if (checked.problems.length) return { state: 'error', text: `Not applied: ${checked.problems.join('; ')}. Until then the device has the lab's identity.` };
  if (!typed) return { state: 'empty', text: 'On, but no field is typed: the device has the lab\'s identity.' };
  const custom = customIdentityFor(checked.value);
  return { state: 'on', text: `Custom identity, typed by you: ${customIdentityFieldsText(custom.fields)}; fingerprint ${custom.properties.get('ro.build.fingerprint')}. The other fields keep the lab's values. Applies when the APK is opened again.` };
}

/** The block's controls, found by id through `byId` (the page's document by default; tests pass a fake). */
export function createCustomIdentityPanel({ byId = id => globalThis.document?.getElementById(id) ?? null, focused = () => globalThis.document?.activeElement ?? null } = {}) {
  const box = () => byId('dev-id'), toggle = () => byId('dev-id-on'), input = key => byId(`dev-id-${key}`), error = key => byId(`dev-id-${key}-error`);
  /** The block as typed now: { on, manufacturer, brand, model, device, name, board, hardware }. */
  function read() { return { on: toggle()?.checked === true, ...Object.fromEntries(CUSTOM_IDENTITY_FIELDS.map(field => [field.key, String(input(field.key)?.value ?? '')])) }; }
  /** Errors under the fields and the status line for `raw` (the block as typed or as stored); returns checkCustomIdentity(raw). */
  function show(raw = read()) {
    const checked = checkCustomIdentity(raw), status = customIdentityStatus(checked);
    for (const field of CUSTOM_IDENTITY_FIELDS) {
      const message = checked.errors[field.key] ?? '', note = error(field.key), control = input(field.key);
      if (note) { note.textContent = message ? `${field.label}: ${message}` : ''; note.hidden = !message; }
      if (control) { if (message) control.setAttribute?.('aria-invalid', 'true'); else control.removeAttribute?.('aria-invalid'); }
    }
    const line = byId('dev-id-status'); if (line) { line.textContent = status.text; line.dataset.state = status.state === 'error' ? 'error' : status.state === 'on' ? 'ok' : ''; }
    const block = box(); if (block?.dataset) block.dataset.state = checked.on ? 'on' : 'off';
    return checked;
  }
  /** The stored block into the controls; a field being typed in is left as it is (its value is trimmed when stored). */
  function write(custom) {
    if (toggle()) toggle().checked = custom?.on === true;
    for (const field of CUSTOM_IDENTITY_FIELDS) { const control = input(field.key); if (control && focused() !== control) control.value = custom?.[field.key] ?? ''; }
    return show(custom ?? null);
  }
  /** The placeholders: the lab's own value of each field (what an empty field keeps), read from the identity table. */
  function init() { for (const field of CUSTOM_IDENTITY_FIELDS) { const control = input(field.key); if (control) control.placeholder = IDENTITY_PROPERTIES.get(field.property) ?? ''; } }
  return { read, show, write, init };
}
