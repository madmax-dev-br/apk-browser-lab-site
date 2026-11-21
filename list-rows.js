// One-line rows for the lists of the Controls panel (Plugins, Endpoint mocks, Redirect hosts): an on/off switch, the item in one line (a button that expands its details), a
// short trailing state, and a "⋯" button with the item's actions in a small menu. The details (longer state, fields) show only when the row is expanded. DOM building only,
// never HTML; works on the tests' small DOM (tests/helpers/mini-dom.mjs).

let menuCounter = 0, openState = null;

/** Closes the open row menu (if any); `restore` gives the focus back to its button. */
export function closeRowMenu(restore = true) {
  if (!openState) return;
  const { node, opener, cleanup } = openState; openState = null;
  node.remove(); cleanup(); opener?.setAttribute?.('aria-expanded', 'false');
  if (restore && opener?.isConnected !== false) opener?.focus?.();
}

/** Opens a menu of `items` ([{ label, run, disabled, danger }]) under `opener`; arrow keys move, Esc closes, a click elsewhere closes. */
export function openRowMenu(opener, items, label) {
  const reopen = openState?.opener === opener; closeRowMenu(false); if (reopen) return null;
  const doc = opener.ownerDocument ?? globalThis.document, view = doc.defaultView ?? globalThis, node = doc.createElement('div'), buttons = [];
  node.className = 'netlog-menu lr-menu'; node.setAttribute('role', 'menu'); node.setAttribute('aria-label', label); node.id = `lr-menu-${++menuCounter}`;
  for (const item of items) {
    if (!item) continue;
    const button = doc.createElement('button'); button.type = 'button'; button.className = `netlog-menu-item${item.danger ? ' is-danger' : ''}`; button.setAttribute('role', 'menuitem'); button.textContent = item.label; button.disabled = !!item.disabled;
    button.addEventListener('click', () => { closeRowMenu(!item.keepFocus); item.run(); });
    node.append(button); buttons.push(button);
  }
  doc.body.append(node);
  const rect = opener.getBoundingClientRect?.() ?? { left: 0, right: 0, top: 0, bottom: 0 }, width = node.offsetWidth || 200, height = node.offsetHeight || 160;
  const below = rect.bottom + 4 + height <= (view.innerHeight ?? 768);
  node.style.left = `${Math.max(4, Math.min(rect.right - width, (view.innerWidth ?? 1024) - width - 4))}px`;
  node.style.top = `${Math.max(4, below ? rect.bottom + 4 : rect.top - height - 4)}px`;
  opener.setAttribute('aria-expanded', 'true'); opener.setAttribute('aria-controls', node.id);
  const onDown = event => { if (!node.contains(event.target) && event.target !== opener && !opener.contains?.(event.target)) closeRowMenu(false); };
  const onKey = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); closeRowMenu(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); const enabled = buttons.filter(button => !button.disabled), at = enabled.indexOf(doc.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    }
    if (event.key === 'Tab') closeRowMenu(false);
  };
  const onScroll = event => { if (!node.contains(event.target)) closeRowMenu(false); };
  doc.addEventListener?.('mousedown', onDown, true); doc.addEventListener?.('keydown', onKey, true); view.addEventListener?.('resize', onScroll); doc.addEventListener?.('scroll', onScroll, true);
  openState = { node, opener, cleanup: () => { doc.removeEventListener?.('mousedown', onDown, true); doc.removeEventListener?.('keydown', onKey, true); view.removeEventListener?.('resize', onScroll); doc.removeEventListener?.('scroll', onScroll, true); } };
  buttons.find(button => !button.disabled)?.focus();
  return node;
}

/**
 * A row: li.lr-row > div.lr-line (switch, main button, trail, "⋯") + div.lr-details (hidden unless expanded).
 * spec: { doc, key, label (the item's accessible name), switchLabel, checked, onToggle, main: [Node], trail: [Node], menu: () => items, expanded, onExpand(bool), details: () => [Node], state }
 */
export function listRow(spec) {
  const { doc } = spec, el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const li = el('li', 'lr-row'), line = el('div', 'lr-line'), detailsId = `lr-details-${spec.key}`;
  if (spec.state) li.dataset.state = spec.state;
  const toggle = el('input', 'lr-switch'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.checked = !!spec.checked; toggle.setAttribute('aria-label', spec.switchLabel);
  toggle.addEventListener('change', () => spec.onToggle(toggle.checked));
  const main = el('button', 'lr-main'); main.type = 'button'; main.setAttribute('aria-expanded', String(!!spec.expanded)); main.setAttribute('aria-controls', detailsId);
  const chevron = el('span', 'lr-chevron', '⌄'); chevron.setAttribute('aria-hidden', 'true');
  main.append(...spec.main, chevron);
  const trail = el('span', 'lr-trail'); trail.append(...(spec.trail ?? []));
  const more = el('button', 'lr-more', '⋯'); more.type = 'button'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-label', `Actions for ${spec.label}`); more.title = 'Actions';
  more.addEventListener('click', () => openRowMenu(more, spec.menu(), `Actions for ${spec.label}`));
  line.append(toggle, main, trail, more);
  const details = el('div', 'lr-details'); details.id = detailsId; details.hidden = !spec.expanded;
  if (spec.expanded) details.append(...spec.details());
  main.addEventListener('click', () => {
    const open = details.hidden; details.hidden = !open; main.setAttribute('aria-expanded', String(open)); li.classList.toggle('is-open', open);
    if (open) details.replaceChildren(...spec.details());
    spec.onExpand?.(open);
  });
  li.classList.toggle('is-open', !!spec.expanded);
  li.append(line, details);
  return li;
}

/** A small definition list for a row's details: [[term, value | Node]] (empty values skipped). */
export function detailList(doc, rows) {
  const dl = doc.createElement('dl'); dl.className = 'lr-facts';
  for (const [term, value] of rows) {
    if (value === undefined || value === null || value === '') continue;
    const dt = doc.createElement('dt'), dd = doc.createElement('dd'); dt.textContent = term;
    if (typeof value === 'object') dd.append(value); else dd.textContent = String(value);
    dl.append(dt, dd);
  }
  return dl;
}
