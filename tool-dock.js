// Bottom tool dock (like Android Studio's tool windows): a bar fixed at the bottom with one icon per tool (Log de execução, Logcat, Rede, Compose, Plugins). A click opens that
// tool's panel over the bottom of the page, half the window high by default, and the page gets as much room below so nothing is hidden behind it (it scrolls up); the
// top edge drags to resize, ▾ hides it, a click on the active icon hides it too. The tools are the same <details> elements as before, moved into the panel: opening a tool
// sets its `open` (their own toggle logic runs: Logcat streams only while open, Compose captures on open), the others close. Their <summary> stays as the panel's header
// (counters and buttons) but no longer toggles. The height is kept per viewer in localStorage (every access guarded); the dock starts hidden.
const HEIGHT_KEY = 'apkweb-tool-dock-height-v1', MIN_HEIGHT = 140, BAR_HEIGHT = 34;
const readHeight = () => { try { const value = Number(globalThis.localStorage?.getItem(HEIGHT_KEY)); return Number.isFinite(value) && value >= MIN_HEIGHT ? value : null; } catch { return null; } };
const writeHeight = value => { try { globalThis.localStorage?.setItem(HEIGHT_KEY, String(Math.round(value))); } catch { /* storage unavailable: the height lasts for this page */ } };

/**
 * root: the dock element (index.html #tool-dock: .tool-dock-bar, .tool-dock-panel with .tool-dock-handle and .tool-dock-slot).
 * tools: [{ id, label, icon, details, count? }] where `details` is the tool's <details> and `count` the element whose text is the tool's counter (shown as the icon's badge).
 * Returns { open(id), close(), active, setHeight(px) }.
 */
export function createToolDock({ root, tools, win = globalThis.window, doc = globalThis.document }) {
  const bar = root.querySelector('.tool-dock-bar'), panel = root.querySelector('.tool-dock-panel'), slot = root.querySelector('.tool-dock-slot'), handle = root.querySelector('.tool-dock-handle'), hide = root.querySelector('.tool-dock-hide');
  const S = { active: null, height: readHeight(), buttons: new Map() };
  const maxHeight = () => Math.max(MIN_HEIGHT, Math.round((win?.innerHeight ?? 800) * 0.85));
  const defaultHeight = () => Math.round((win?.innerHeight ?? 800) / 2);
  const clamp = value => Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(value)));
  const layout = () => {   // the page keeps room for the bar and the open panel, so the content above can scroll fully into view
    const height = S.active ? clamp(S.height ?? defaultHeight()) : 0;
    root.style.setProperty('--tool-dock-height', `${height}px`);
    doc.body.style.paddingBottom = `${BAR_HEIGHT + height}px`;
    panel.hidden = !S.active; handle.setAttribute('aria-valuenow', String(height)); handle.setAttribute('aria-valuemax', String(maxHeight()));
  };
  const tool = id => tools.find(item => item.id === id);
  function open(id) {
    const chosen = tool(id); if (!chosen || chosen.details.hidden) return;
    for (const item of tools) if (item !== chosen && item.details.open) item.details.open = false;
    if (chosen.details.parentElement !== slot) slot.append(chosen.details);
    for (const item of tools) item.details.classList.toggle('tool-dock-current', item === chosen);
    chosen.details.open = true; S.active = id;
    for (const [key, button] of S.buttons) { button.setAttribute('aria-pressed', String(key === id)); button.classList.toggle('active', key === id); }
    layout();
  }
  function close() {
    const current = tool(S.active); if (current) current.details.open = false;
    S.active = null; for (const button of S.buttons.values()) { button.setAttribute('aria-pressed', 'false'); button.classList.remove('active'); }
    layout();
  }
  for (const item of tools) {
    const button = doc.createElement('button'), icon = doc.createElement('span'), label = doc.createElement('span'), badge = doc.createElement('span');
    button.type = 'button'; button.className = 'tool-dock-tab'; button.dataset.tool = item.id; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-controls', item.details.id);
    icon.className = 'tool-dock-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = item.icon;
    label.className = 'tool-dock-label'; label.textContent = item.label; badge.className = 'tool-dock-badge';
    button.append(icon, label, badge);
    button.addEventListener('click', () => { if (S.active === item.id) close(); else open(item.id); });
    bar.append(button); S.buttons.set(item.id, button);
    slot.append(item.details); item.details.open = false; item.details.classList.add('tool-dock-tool');
    // the summary is the panel's header now: its own buttons still work, clicking it no longer toggles the tool (the dock does)
    const summary = item.details.querySelector(':scope > summary');
    summary?.addEventListener('click', event => { if (!event.target.closest?.('button, a, input, select, label')) event.preventDefault(); });
    summary?.setAttribute('tabindex', '-1');
    // a tool that hides itself (Plugins with no plugin running) hides its icon; the dock closes if it was showing it
    const sync = () => { const count = item.count?.textContent?.trim() ?? ''; badge.textContent = count; button.title = count ? `${item.label}: ${count}` : item.label; button.hidden = item.details.hidden; if (item.details.hidden && S.active === item.id) close(); };
    sync();
    // code that opens or closes a tool directly (an error report opening the execution log) moves the dock along
    item.details.addEventListener('toggle', () => { if (item.details.open && S.active !== item.id) open(item.id); else if (!item.details.open && S.active === item.id) { S.active = null; for (const other of S.buttons.values()) { other.setAttribute('aria-pressed', 'false'); other.classList.remove('active'); } layout(); } });
    if (typeof MutationObserver === 'function') {
      new MutationObserver(sync).observe(item.details, { attributes: true, attributeFilter: ['hidden'] });
      if (item.count) new MutationObserver(sync).observe(item.count, { childList: true, characterData: true, subtree: true });
    }
  }
  hide?.addEventListener('click', () => close());
  // resize by the top edge: pointer drag, or the arrow keys on the focused handle (role="separator")
  handle.addEventListener('pointerdown', event => {
    event.preventDefault(); handle.setPointerCapture?.(event.pointerId); root.classList.add('resizing');
    const startY = event.clientY, startHeight = clamp(S.height ?? defaultHeight());
    const move = moved => { S.height = clamp(startHeight + (startY - moved.clientY)); layout(); };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); root.classList.remove('resizing'); writeHeight(S.height); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', event => {
    const step = event.shiftKey ? 80 : 24, current = clamp(S.height ?? defaultHeight());
    const next = event.key === 'ArrowUp' ? current + step : event.key === 'ArrowDown' ? current - step : event.key === 'Home' ? maxHeight() : event.key === 'End' ? MIN_HEIGHT : null;
    if (next === null) { if (event.key === 'Escape') close(); return; }
    event.preventDefault(); S.height = clamp(next); layout(); writeHeight(S.height);
  });
  win?.addEventListener?.('resize', () => { if (S.active) layout(); });
  doc.addEventListener('keydown', event => { if (event.key === 'Escape' && S.active && root.contains(doc.activeElement)) close(); });
  layout();
  return { open, close, get active() { return S.active; }, setHeight(value) { S.height = clamp(value); layout(); }, state: S };
}
