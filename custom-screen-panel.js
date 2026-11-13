// "Tela" -> "Personalizado" in the device panel: width, height and a dp/px unit, converted with the VM density (device-profile.js checkCustomScreen).
// The panel only reads and writes these inputs; the value goes through sanitizeSettings / resolveDevice like a preset does.
import { checkCustomScreen, SCREEN_DENSITY } from './device-profile.js?v=e0da55c6005f';

/**
 * @param $ id -> element
 * @returns { write(settings), read(fallback) -> a valid customScreen (the fallback while the typed one is invalid) }
 */
export function createCustomScreenPanel({ $ }) {
  const box = $('dev-custom-screen'), width = $('dev-custom-w'), height = $('dev-custom-h'), unit = $('dev-custom-unit'), message = $('dev-custom-msg');
  let shownUnit = 'dp';
  const describe = checked => `${checked.widthPx} × ${checked.heightPx} px · ${checked.widthDp} × ${checked.heightDp} dp (densidade ${String(SCREEN_DENSITY).replace('.', ',')}). Largura e altura em retrato; a orientação gira a tela.`;
  const show = (text, invalid) => { message.textContent = text; message.dataset.state = invalid ? 'error' : ''; width.setAttribute('aria-invalid', String(!!invalid)); height.setAttribute('aria-invalid', String(!!invalid)); };
  // Switching the unit converts the typed numbers (px = dp x density), so the screen keeps its size. Capture phase, registered before the panel's own
  // 'input' listener: the conversion happens before the settings are read.
  unit?.addEventListener('input', () => {
    const next = unit.value, factor = next === 'px' ? SCREEN_DENSITY : 1 / SCREEN_DENSITY;
    for (const input of [width, height]) if (input.value.trim() && Number.isFinite(Number(input.value)) && next !== shownUnit) input.value = String(Math.round(Number(input.value) * factor));
    shownUnit = next;
  }, true);
  return {
    write(settings) {
      if (!box) return;
      const custom = settings.customScreen, active = settings.screen === 'custom'; box.hidden = !active;
      // the inputs keep what the user is typing (even invalid) while the custom screen is selected; they are only refilled from the settings otherwise
      if (!active || document.activeElement !== width && document.activeElement !== height) { width.value = String(custom.width); height.value = String(custom.height); unit.value = custom.unit; shownUnit = custom.unit; }
      const checked = checkCustomScreen({ width: width.value, height: height.value, unit: unit.value });
      show(checked.error ?? describe(checked), !!checked.error);
    },
    read(fallback) {
      if (!box) return fallback;
      const checked = checkCustomScreen({ width: width.value, height: height.value, unit: unit.value });
      show(checked.error ?? describe(checked), !!checked.error);
      return checked.value ?? fallback;
    },
  };
}
