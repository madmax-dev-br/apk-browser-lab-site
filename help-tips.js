// "?" help tips of the Controles panel: the long explanations stay in the page (same elements, same ids, so aria-describedby and any code that reads them keep working) but
// move into a small bubble shown while the pointer is over the "?" icon or the icon has keyboard focus. Status lines (role="status") are never moved: they change while the
// app runs and must stay visible.
//   - a <small> hint inside a field's label text (label.cp-field > span > small, label.cp-check > span > small): the icon follows the label text;
//   - a static paragraph (p.cp-note without role="status", not listed in KEEP): the icon goes after the label of the field right before it, or into the section's heading
//     when it opens the section; a debugging warning (p.cp-note.ov-warning) gets a "!" icon.
const KEEP = new Set(['perms-empty', 'vm-memory-device']);   // state messages without role="status": they say what to do next
let counter = 0;

function makeTip(doc, content, { warning = false, label = 'Ajuda' } = {}) {
  const wrap = doc.createElement('span'), button = doc.createElement('button'), bubble = doc.createElement('span'), id = `help-tip-${++counter}`;
  wrap.className = `help-tip${warning ? ' warning' : ''}`;
  button.type = 'button'; button.className = 'help-tip-icon'; button.textContent = warning ? '!' : '?';
  button.setAttribute('aria-label', label); button.setAttribute('aria-describedby', id);
  bubble.className = 'help-tip-bubble'; bubble.id = id; bubble.setAttribute('role', 'tooltip');
  bubble.append(content);
  // inside a <label> or a <summary> a click must not toggle the control or the section; Escape hides the bubble
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); button.focus(); });
  button.addEventListener('keydown', event => { if (event.key === 'Escape') button.blur(); });
  // The bubble is fixed to the viewport next to its icon: the panel it lives in scrolls (overflow), which would clip an absolutely positioned one.
  // Below the icon when it fits, above it otherwise; kept inside the window sideways.
  const place = () => {
    const view = doc.defaultView; if (!view || typeof button.getBoundingClientRect !== 'function') return;
    const icon = button.getBoundingClientRect(), box = bubble.getBoundingClientRect(), margin = 8;
    const left = Math.max(margin, Math.min(icon.left - 8, view.innerWidth - box.width - margin));
    const below = icon.bottom + 4, top = below + box.height + margin <= view.innerHeight ? below : Math.max(margin, icon.top - 4 - box.height);
    bubble.style.left = `${Math.round(left)}px`; bubble.style.top = `${Math.round(top)}px`;
  };
  for (const type of ['mouseenter', 'focusin']) wrap.addEventListener(type, () => { place(); doc.defaultView?.requestAnimationFrame?.(place); });   // again once it is laid out (its height is known only when shown)
  wrap.append(button, bubble);
  return wrap;
}
/** The name of a field or section for the icon's aria-label: its own text, without hints, badges or other tips. */
function labelText(node) {
  if (!node) return '';
  let text = '';
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) text += child.textContent;
    else if (child.nodeType === 1 && !child.matches?.('small, em, .help-tip, .quiet-badge, output')) text += child.textContent;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Turns the long texts under `root` into "?" tips. Idempotent (an element already moved is skipped). Returns the number of tips made. */
export function initHelpTips(root) {
  if (!root?.querySelectorAll) return 0;
  const doc = root.ownerDocument ?? globalThis.document; let made = 0;
  for (const small of [...root.querySelectorAll('label.cp-field > span > small, label.cp-check > span > small')]) {
    if (small.closest('.help-tip-bubble') || !small.textContent.trim()) continue;
    const span = small.parentElement, title = labelText(span);
    const tip = makeTip(doc, small, { label: `Ajuda: ${title}` });
    span.append(tip); made++;
  }
  for (const note of [...root.querySelectorAll('p.cp-note')]) {
    if (note.closest('.help-tip-bubble') || note.getAttribute('role') === 'status' || KEEP.has(note.id) || !note.textContent.trim()) continue;
    const warning = note.classList.contains('ov-warning');
    let anchor = note.previousElementSibling;
    while (anchor && !(anchor.matches?.('label.cp-field, label.cp-check'))) { if (anchor.matches?.('p.cp-note, .help-tip')) { anchor = anchor.previousElementSibling; continue; } anchor = null; }
    const section = note.closest('details.cp-group');   // the heading first: a selector list would return the summary, which comes first in document order
    const host = anchor?.querySelector(':scope > span') ?? section?.querySelector(':scope > summary h3') ?? section?.querySelector(':scope > summary') ?? null;
    if (!host) continue;
    // a field that already has a "?" (its <small> hint) gets the note in the same bubble: one icon per field
    const existing = !warning && host.tagName !== 'H3' ? host.querySelector(':scope > .help-tip:not(.warning) > .help-tip-bubble') : null;
    if (existing) { existing.append(note); made++; continue; }
    const tip = makeTip(doc, note, { warning, label: `${warning ? 'Aviso' : 'Ajuda'}: ${labelText(host)}` });
    if (host.tagName === 'H3') host.after(tip); else host.append(tip);
    made++;
  }
  return made;
}
