// Buttons that belong to a plugin (lab.button of src/plugin-runtime.js, docs/PLUGINS.md "Botões do plugin"). The plugin declares them as data; the page renders them as real
// <button>s (text only, never HTML) in the plugin's own entry (its output card in the dock and its row in Controles › Plugins, placement 'plugin') or in the device preview's
// bar next to Recriar / Reabrir / Voltar / Tela cheia (placement 'toolbar', marked with the plugin's name). A click goes to the plugin's Worker (src/plugin-host.js
// clickButton); while its handler runs the button is busy (aria-busy) and ignores further clicks. The host drops a plugin's buttons when it stops. No process.*.

export const BUTTON_LIMITS = { perPlugin: 12, label: 40, title: 200, icon: 2, id: 40 };
export const BUTTON_VARIANTS = ['default', 'primary', 'danger'], BUTTON_PLACEMENTS = ['plugin', 'toolbar'];
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;   // control characters and bidi overrides: a label is one plain line
/** Plain one-line text, at most `max` characters (an ellipsis marks a cut). */
export function buttonText(value, max) {
  const text = String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim(), chars = [...text];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text;
}
/** The first `max` user-perceived characters (an emoji with modifiers is one). */
function graphemes(text, max) {
  if (typeof Intl?.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].slice(0, max).map(part => part.segment).join('');
  return [...text].slice(0, max).join('');
}
/** A button id the plugin chose -> [\w-] (or '' when none). */
export const buttonId = value => value === undefined || value === null ? '' : String(value).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, BUTTON_LIMITS.id);
/**
 * What a plugin passed to lab.button / button.update -> the button the page renders. `previous` is the current state (an update changes only the keys it names).
 * label: text (40); icon: an emoji or up to 2 characters; title: the tooltip (200); variant: 'default' | 'primary' | 'danger'; disabled; placement: 'plugin' | 'toolbar'.
 */
export function sanitizeButtonConfig(raw = {}, previous = null) {
  const item = raw && typeof raw === 'object' ? raw : {}, base = previous ?? { label: '', icon: '', title: '', variant: 'default', disabled: false, placement: 'plugin' };
  const has = key => Object.prototype.hasOwnProperty.call(item, key) && item[key] !== undefined;
  const out = {
    label: has('label') ? buttonText(item.label, BUTTON_LIMITS.label) : base.label,
    icon: has('icon') ? graphemes(buttonText(item.icon, 16), BUTTON_LIMITS.icon) : base.icon,
    title: has('title') ? buttonText(item.title, BUTTON_LIMITS.title) : base.title,
    variant: has('variant') ? (BUTTON_VARIANTS.includes(item.variant) ? item.variant : 'default') : base.variant,
    disabled: has('disabled') ? item.disabled === true : base.disabled,
    placement: has('placement') ? (BUTTON_PLACEMENTS.includes(item.placement) ? item.placement : 'plugin') : base.placement,
  };
  if (!out.label && !out.icon) out.label = 'Botão';
  return out;
}
/** The public view of a button (lab.buttons.list, the MCP plugins tool). */
export const buttonOut = button => ({ id: button.id, label: button.label, icon: button.icon, title: button.title, variant: button.variant, disabled: button.disabled, placement: button.placement, busy: !!button.busy, clicks: button.clicks ?? 0 });

/**
 * Keeps `container`'s children equal to `items` ([{ key, pluginId, pluginName, button }]) as <button>s, reusing the element of a key (focus and hover survive a re-render).
 * onClick(pluginId, buttonId) runs on a click that is not ignored (busy or disabled). `toolbar`: the tooltip names the plugin. Returns whether anything is shown.
 */
export function syncButtons(container, items, { onClick, toolbar = false } = {}) {
  if (!container) return false;
  const doc = container.ownerDocument ?? globalThis.document, old = new Map();
  for (const node of container.children) if (node.dataset?.key) old.set(node.dataset.key, node);
  const nodes = items.map(({ key, pluginId, pluginName, button }) => {
    let node = old.get(key);
    if (!node) {
      node = doc.createElement('button'); node.type = 'button'; node.dataset.key = key;
      const icon = doc.createElement('span'), label = doc.createElement('span'); icon.className = 'pb-icon'; icon.setAttribute('aria-hidden', 'true'); label.className = 'pb-label'; node.append(icon, label);
      node.addEventListener('click', event => { event?.preventDefault?.(); const current = node.pbState; if (!current || current.button.busy || current.button.disabled) return; onClick?.(current.pluginId, current.button.id); });
    }
    const state = { pluginId, pluginName, button }; node.pbState = state;
    const sig = JSON.stringify([button.label, button.icon, button.title, button.variant, button.disabled, !!button.busy, pluginName, toolbar]);
    if (node.pbSig !== sig) {
      node.pbSig = sig;
      node.className = `cp-button pb-button${toolbar ? ' pb-toolbar-button' : ''}${button.variant !== 'default' ? ` pb-${button.variant}` : ''}${button.busy ? ' is-busy' : ''}`;
      node.dataset.plugin = pluginId; node.dataset.button = button.id; node.dataset.variant = button.variant;
      const [icon, label] = node.children; icon.textContent = button.icon; icon.hidden = !button.icon; label.textContent = button.label; label.hidden = !button.label;
      const tip = button.title || button.label || button.icon;
      node.title = toolbar ? `${tip} · plugin ${pluginName}` : tip;
      node.setAttribute('aria-label', toolbar ? `${button.label || button.title || button.icon} (plugin ${pluginName})` : (button.label || button.title || button.icon));
      node.disabled = !!button.disabled;
      node.setAttribute('aria-busy', button.busy ? 'true' : 'false'); node.setAttribute('aria-disabled', button.busy || button.disabled ? 'true' : 'false');
    }
    return node;
  });
  if (nodes.length !== container.children.length || nodes.some((node, index) => container.children[index] !== node)) container.replaceChildren(...nodes);
  container.hidden = !nodes.length;
  return nodes.length > 0;
}
/** The buttons of one plugin in one placement, as syncButtons items. */
export const buttonItems = (plugin, live, placement) => (live?.buttons ?? []).filter(button => button.placement === placement).map(button => ({ key: `${plugin.id}:${button.id}`, pluginId: plugin.id, pluginName: plugin.name, button }));
