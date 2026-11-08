// Collapsible sections of the "Controles" panel: every `details.cp-group[data-section]` keeps its open/closed state in localStorage (per viewer; every access guarded, the panel works without
// storage). Default: the first section open, the others closed.
const KEY = 'apkweb-cp-sections-v1';
function readSaved() { try { const value = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function writeSaved(saved) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(saved)); } catch { /* storage unavailable: the state lasts for this page only */ } }
export function initCollapsibleSections(root) {
  const sections = [...root.querySelectorAll('details.cp-group[data-section]')], saved = readSaved();
  sections.forEach((section, index) => {
    const id = section.dataset.section;
    section.open = typeof saved[id] === 'boolean' ? saved[id] : index === 0;
    section.addEventListener('toggle', () => { if (saved[id] === section.open) return; saved[id] = section.open; writeSaved(saved); });
  });
  return sections;
}
