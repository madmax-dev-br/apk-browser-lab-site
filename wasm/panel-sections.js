// Collapsible sections of the "Controles" panel: every `details.cp-group[data-section]` starts collapsed on each load, so the panel opens clean; the viewer opens what they need.
export function initCollapsibleSections(root) {
  const sections = [...root.querySelectorAll('details.cp-group[data-section]')];
  for (const section of sections) section.open = false;
  return sections;
}
