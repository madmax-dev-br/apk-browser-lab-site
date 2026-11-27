// "?" help of the Controles panel: one icon per section, in its heading. The section's long explanations (the <small> hints of its fields and its static paragraphs) leave
// the page and open in a dialog: one tab per field or topic when there are several, the text alone when there is one. The texts stay in the document (same elements, same
// ids, kept in a hidden store inside the section), so aria-describedby and any code that reads them keep working. Status lines (role="status") are never moved: they change
// while the app runs and must stay visible.
//   - a <small> hint inside a field's label text (label.cp-field > span > small, label.cp-check > span > small): its tab is named after the field;
//   - a static paragraph (p.cp-note without role="status", not listed in KEEP): its tab is named after the field that points at it (aria-describedby), the field right
//     before it, the sub-section it sits in (data-help-title, legend or .cp-subtitle), or "Overview"; a debugging warning (p.cp-note.ov-warning) gets a "!" on its tab and on the icon.
//   - texts inside [data-help-skip] are left where they are: a block that shows its own notes (the microG settings dialog, src/microg-settings-dialog.js).
// A section made of groups (section.cp-sub with an h4.cp-subtitle: Device › Screen, Network › Proxy and relay…) gets its tabs listed under the group names, in page order.
import { createModalHost } from './lab-modal.js?v=5abc89d1cc06';

const KEEP = new Set(['perms-empty', 'vm-memory-device']);   // state messages without role="status": they say what to do next
const OVERVIEW = 'Overview';
let counter = 0;
let sharedHost = null;

/** The name of a field or section: its own text, without hints, badges or other tips. */
function labelText(node) {
  if (!node) return '';
  let text = '';
  for (const child of node.childNodes ?? []) {
    if (child.nodeType === 3) text += child.textContent;
    else if (child.nodeType === 1 && !child.matches?.('small, em, output, .help-tip, .quiet-badge, .cp-badge, .mtls-pill, .trace-chevron')) text += child.textContent;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** The label of a form control: label[for=id] or the label that wraps it. */
function controlLabel(section, control) {
  if (!control) return null;
  if (control.id) for (const label of section.querySelectorAll('label[for]')) if (label.getAttribute('for') === control.id) return label;
  return control.closest?.('label') ?? null;
}

/** The tab a static paragraph belongs to. */
function noteTitle(section, note) {
  const named = note.closest('[data-help-title]');   // a name the page gives it (a box with no heading of its own)
  if (named && section.contains(named)) return named.dataset.helpTitle;
  if (note.id) {   // a field that names it in aria-describedby
    for (const control of section.querySelectorAll('[aria-describedby]')) {
      if (!control.getAttribute('aria-describedby').split(/\s+/).includes(note.id)) continue;
      const label = controlLabel(section, control), text = labelText(label?.matches?.('.cp-field, .cp-check') ? label.querySelector(':scope > span') ?? label : label);
      if (text) return text;
    }
  }
  for (let node = note.previousElementSibling; node; node = node.previousElementSibling) {   // the field right before it (other notes and status lines in between are skipped)
    if (node.matches?.('p.cp-note, .help-tip')) continue;
    if (node.matches?.('label.cp-field, label.cp-check')) return labelText(node.querySelector(':scope > span') ?? node);
    if (node.matches?.('.cp-subtitle')) return labelText(node);
    break;
  }
  for (let box = note.parentElement; box && box !== section; box = box.parentElement) {   // the sub-section it sits in
    const heading = box.querySelector(':scope > legend, :scope > .cp-subtitle');
    if (heading) return labelText(heading);
  }
  for (let node = note.previousElementSibling; node; node = node.previousElementSibling) if (node.matches?.('.cp-subtitle')) return labelText(node);
  return OVERVIEW;
}

/** The group (section.cp-sub) a text sits in: its heading's name, or '' outside a group. */
function groupOf(section, node) {
  const sub = node.closest?.('.cp-sub');
  return sub && section.contains(sub) ? labelText(sub.querySelector(':scope > .cp-subtitle')) : '';
}

/** The section's items in document order, merged by group and tab name: [{ title, group, nodes: [Element], warning }]. */
function collect(section) {
  const found = [];
  for (const small of section.querySelectorAll('label.cp-field > span > small, label.cp-check > span > small')) {
    if (small.closest('.help-store, [data-help-skip]') || !small.textContent.trim()) continue;
    found.push({ node: small, title: labelText(small.parentElement) || OVERVIEW, group: groupOf(section, small), warning: false });
  }
  for (const note of section.querySelectorAll('p.cp-note')) {
    if (note.closest('.help-store, [data-help-skip]') || note.getAttribute('role') === 'status' || KEEP.has(note.id) || !note.textContent.trim()) continue;
    found.push({ node: note, title: noteTitle(section, note), group: groupOf(section, note), warning: note.classList.contains('ov-warning') });
  }
  found.sort((a, b) => (a.node.compareDocumentPosition(b.node) & 4 ? -1 : 1));   // DOCUMENT_POSITION_FOLLOWING: a comes first
  const items = new Map();
  for (const { node, title, group, warning } of found) {
    const key = `${group}\u0000${title}`, item = items.get(key) ?? { title, group, nodes: [], warning: false };
    item.nodes.push(node); item.warning ||= warning; items.set(key, item);
  }
  const list = [...items.values()];
  const overview = list.findIndex(item => item.title === OVERVIEW && !item.group);   // the section's introduction comes first
  if (overview > 0) list.unshift(...list.splice(overview, 1));
  return list;
}

/** The dialog's content: the texts alone for one item, a vertical tab list and one panel per item otherwise, with the group names between the tabs when the section has
 *  groups (a tab named as its group, the group's introduction, reads "About"). The item boxes are moved in and back out by the caller. */
function buildDialog(doc, items, boxes) {
  const root = doc.createElement('div'); root.className = 'help-dialog';
  if (items.length === 1) { root.append(boxes[0]); boxes[0].hidden = false; return { root, focus: null }; }
  const serial = ++counter, tablist = doc.createElement('div'), panels = doc.createElement('div'), tabs = [];
  root.classList.add('help-dialog-tabs');
  tablist.className = 'help-tablist'; tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-orientation', 'vertical');
  panels.className = 'help-panels';
  const select = (index, focus = false) => {
    tabs.forEach((tab, i) => { const on = i === index; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; boxes[i].hidden = !on; });
    if (focus) tabs[index].focus();
  };
  const grouped = new Set(items.map(item => item.group ?? '')).size > 1;
  let lastGroup = null, groupId = null;
  items.forEach((item, i) => {
    const group = item.group ?? '';
    if (group !== lastGroup) {
      groupId = null;
      if (grouped && group) {   // a group name: not a tab (role=presentation); its tabs point at it with aria-describedby
        const head = doc.createElement('div'); head.className = 'help-group'; head.setAttribute('role', 'presentation'); head.id = groupId = `help-group-${serial}-${i}`; head.textContent = group; tablist.append(head);
      }
      lastGroup = group;
    }
    const tab = doc.createElement('button'), box = boxes[i];
    if (groupId) tab.setAttribute('aria-describedby', groupId);
    tab.type = 'button'; tab.className = `help-tab${item.warning ? ' warning' : ''}`; tab.setAttribute('role', 'tab');
    tab.id = `help-tab-${serial}-${i}`; box.id = `help-panel-${serial}-${i}`;
    tab.setAttribute('aria-controls', box.id); box.setAttribute('role', 'tabpanel'); box.setAttribute('aria-labelledby', tab.id); box.tabIndex = 0;
    tab.textContent = grouped && item.title === group ? 'About' : item.title;
    if (item.warning) { const mark = doc.createElement('span'); mark.className = 'help-tab-mark'; mark.textContent = '!'; mark.setAttribute('aria-label', 'warning'); tab.prepend(mark); }
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', event => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (step) { event.preventDefault(); select((i + step + tabs.length) % tabs.length, true); }
      else if (event.key === 'Home') { event.preventDefault(); select(0, true); }
      else if (event.key === 'End') { event.preventDefault(); select(tabs.length - 1, true); }
    });
    tabs.push(tab); tablist.append(tab); panels.append(box);
  });
  root.append(tablist, panels); select(0);
  return { root, focus: tabs[0] };
}

/**
 * Gathers the long texts of each section (details.cp-group) under `root` behind one "?" icon in its heading. Idempotent: texts already gathered are skipped, and a section
 * that gains new ones later keeps its single icon. options.modalHost: the page's modal host (src/lab-modal.js); one is made when absent. Returns the number of texts gathered.
 */
export function initHelpTips(root, { modalHost = null } = {}) {
  if (!root?.querySelectorAll) return 0;
  const doc = root.ownerDocument ?? globalThis.document; let made = 0;
  const host = () => modalHost ?? (sharedHost ??= createModalHost({ doc, win: doc.defaultView }));
  for (const section of root.querySelectorAll('details.cp-group')) {
    const items = collect(section); if (!items.length) continue;
    const summary = section.querySelector(':scope > summary'), heading = summary?.querySelector('h3') ?? summary;
    if (!heading) continue;
    let store = section.querySelector(':scope .help-store');
    if (!store) { store = doc.createElement('div'); store.className = 'help-store'; store.hidden = true; (section.querySelector(':scope > .cp-body') ?? section).append(store); }
    for (const item of items) {
      let box = [...store.children].find(child => child.dataset.title === item.title && (child.dataset.group ?? '') === item.group);
      if (!box) { box = doc.createElement('div'); box.className = 'help-item'; box.dataset.title = item.title; if (item.group) box.dataset.group = item.group; store.append(box); }
      if (item.warning) box.dataset.warning = 'true';
      for (const node of item.nodes) { box.append(node); made++; }
    }
    if (summary.querySelector('.help-tip')) { summary.querySelector('.help-tip').classList.toggle('warning', !!store.querySelector('[data-warning]')); continue; }
    const title = labelText(heading) || 'this section';
    const wrap = doc.createElement('span'), button = doc.createElement('button');
    wrap.className = `help-tip${store.querySelector('[data-warning]') ? ' warning' : ''}`;
    button.type = 'button'; button.className = 'help-tip-icon'; button.textContent = '?';
    button.setAttribute('aria-label', `Help: ${title}`); button.setAttribute('aria-haspopup', 'dialog'); button.title = `Help: ${title}`;
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();   // inside the <summary>: the click must not open or close the section
      const boxes = [...store.children], list = boxes.map(box => ({ title: box.dataset.title, group: box.dataset.group ?? '', warning: box.dataset.warning === 'true' }));
      if (!boxes.length) return;
      const ids = boxes.map(box => box.id), { root: content, focus } = buildDialog(doc, list, boxes);
      host().open({
        title: `Help: ${title}`, size: list.length > 1 ? 'medium' : 'small', content,
        onClose: () => boxes.forEach((box, i) => {   // the texts go back to the section's store, as they were
          box.hidden = false; box.removeAttribute('role'); box.removeAttribute('aria-labelledby'); box.removeAttribute('tabindex');
          if (ids[i]) box.id = ids[i]; else box.removeAttribute('id');
          store.append(box);
        }),
      });
      focus?.focus?.();
    });
    button.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); });   // the summary would toggle on Space/Enter
    wrap.append(button);
    heading.after(wrap);
  }
  return made;
}
