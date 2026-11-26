// The Controls panel's own behaviour (src/index.html #control-panel): the "Find a control" box and the one-line summary on each section's row.
//   - Find: typing filters the sections, their groups (section.cp-sub, by heading) and their controls (.cp-item, label.cp-field, label.cp-check, by label text and data-keywords)
//     and opens what matches (the sections and the "Advanced" disclosures that hold a match); clearing it (or Esc) puts every section and disclosure back as it was before.
//     Matching is by words, case- and accent-insensitive. Nothing is removed from the page: what does not match gets the class cp-filtered-out (display:none in the CSS).
//   - Summaries (span.cp-sum in each section's summary): composed from what the panel already shows (the values of its fields, the groups' own badges and status lines),
//     so they stay right however a value was changed (the panel, a plugin, MCP, a reset). Recomputed on input/change in the panel and when an observed badge or status changes.

const ITEM = '.cp-item, fieldset.cp-core, label.cp-field, label.cp-check, .pl-power, .cp-microg-open';
const fold = text => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const count = text => { const match = /^(\d+)/.exec(String(text ?? '').trim()); return match ? Number(match[1]) : 0; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The text an element is found by: its label's own words (not the hints the "?" help keeps), the heading of a group, and its data-keywords. */
function searchText(node) {
  if (!node) return '';
  const own = node.matches?.('.cp-sub') ? node.querySelector(':scope > .cp-subtitle') : node.matches?.('label') ? node : node.querySelector?.('label, .cp-button, legend') ?? node;
  let text = '';
  const walk = element => { for (const child of element.childNodes ?? []) { if (child.nodeType === 3) text += ` ${child.textContent}`; else if (child.nodeType === 1 && !child.matches?.('small, .cp-badge, .help-tip, output, select, option, input, textarea, [role=status]')) walk(child); } };
  if (own) walk(own);
  return fold(`${text} ${node.dataset?.keywords ?? ''}`).replace(/\s+/g, ' ').trim();
}

/** True when every word of the query appears in the text (each word anywhere, in any order). */
export function matchesQuery(text, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(word => text.includes(word));
}

/** The Network section's line, from what its groups show: connectivity, the proxy or relay in use, redirects and mocks. Pure: tests call it with plain values. */
export function networkSummary({ connectivity = 'online', proxyText = '', proxyState = '', redirects = 0, mocks = 0, blocked = 0 } = {}) {
  const parts = [{ online: 'Wi‑Fi', metered: 'mobile data', offline: 'offline' }[connectivity] ?? connectivity];
  if (proxyState === 'ok') parts.push(proxyText.trim() ? 'proxy ✓' : 'relay ✓');
  else if (proxyState === 'error') parts.push('proxy ✕');
  if (redirects) parts.push(plural(redirects, 'redirect'));
  if (mocks) parts.push(plural(mocks, 'mock'));
  if (blocked) parts.push(plural(blocked, 'blocked rule'));   // calls the user chose not to make
  return parts.join(' · ');
}

/** Every section's line, read from the page. Returns { sectionId: { text, state } }; state 'warn' marks a section whose tools change the app's behaviour. */
export function sectionSummaries($) {
  const text = id => $(id)?.textContent?.trim() ?? '', on = id => $(id)?.checked === true, value = id => $(id)?.value ?? '';
  const device = [text('device-summary')];
  if (on('dev-microg')) device.push('microG'); if (on('dev-arm64')) device.push('ARM64'); if (on('dev-gles-cpu')) device.push('GLES on CPU'); if (on('dev-id-on')) device.push('custom identity');
  const app = [text('perms-summary') === 'no app' ? '' : `permissions ${text('perms-summary')}`, text('cam-summary') === 'test pattern' ? '' : `camera: ${text('cam-summary')}`].filter(Boolean);
  const files = text('files-summary'), appdata = text('appdata-summary');
  const data = [files && files !== 'none' ? `${files.split(' · ')[0]} file${files.startsWith('1 ') ? '' : 's'}` : '', appdata && appdata !== '—' ? appdata : '', on('keep-app-data') ? '' : 'not kept'].filter(Boolean);
  const engine = value('vm-engine') === 'js' ? 'JS VM' : 'Wasm core', tolerant = { off: 'strict', void: 'tolerant: void', primitives: '', all: 'tolerant: all' }[value('tolerate-missing')] ?? '';
  const run = [engine, value('vm-renderer') === 'cpu' ? 'CPU' : 'GPU', tolerant, on('strict-crash') ? 'strict crash' : ''].filter(Boolean);
  const returns = count(text('ov-summary')), ignored = count(text('ia-summary'));
  const debug = [returns ? plural(returns, 'return') : '', ignored ? `${ignored} ignored` : '', on('dev-layout-bounds') ? 'bounds' : '', on('dev-frame-graph') ? 'FPS' : ''].filter(Boolean);
  const plugins = count(text('pl-summary')), running = Number(/(\d+) running/.exec(text('pl-summary') ?? '')?.[1] ?? 0), mcp = text('mcp-summary');
  const ext = [plugins ? `${plugins} plugin${plugins === 1 ? '' : 's'}${running ? ` (${running} running)` : ''}` : 'no plugins', `MCP ${mcp || 'off'}`];
  const proxyNote = $('dev-proxy-note');
  return {
    'cp-sum-device': { text: device.filter(Boolean).join(' · '), state: '' },
    'cp-sum-network': { text: networkSummary({ connectivity: value('dev-network'), proxyText: value('dev-proxy'), proxyState: proxyNote?.dataset?.state ?? '', redirects: count(text('hm-summary')), mocks: count(text('em-summary')), blocked: count(text('bc-summary')) }), state: count(text('em-summary')) || count(text('bc-summary')) ? 'warn' : '' },
    'cp-sum-app': { text: app.join(' · ') || (text('perms-summary') === 'no app' ? 'no app' : ''), state: '' },
    'cp-sum-data': { text: data.join(' · ') || 'no files', state: '' },
    'cp-sum-run': { text: run.join(' · '), state: '' },
    'cp-sum-debug': { text: debug.join(' · ') || 'off', state: returns || ignored ? 'warn' : '' },
    'cp-sum-ext': { text: ext.join(' · '), state: '' },
  };
}

/** The badges and status lines a summary reads; a change in any of them recomputes the summaries. */
const WATCHED = ['device-summary', 'dev-microg-summary', 'perms-summary', 'cam-summary', 'files-summary', 'appdata-summary', 'hm-summary', 'em-summary', 'ov-summary', 'ia-summary', 'pl-summary', 'mcp-summary', 'dev-proxy-note'];

/**
 * Wires the panel: the filter box (#cp-filter) and the section summaries. `root` is #control-panel. Returns { filter(query), refresh() } for tests and other modules.
 */
export function initControlPanelUI(root, { doc = root?.ownerDocument ?? globalThis.document } = {}) {
  if (!root?.querySelectorAll) return null;
  const $ = id => doc.getElementById(id);
  const sections = () => [...root.querySelectorAll('details.cp-group')];
  // ---- summaries ----
  let pending = false;
  const refresh = () => {
    pending = false;
    for (const [id, { text, state }] of Object.entries(sectionSummaries($))) {
      const badge = $(id); if (!badge) continue;
      if (badge.textContent !== text) badge.textContent = text;
      if ((badge.dataset.state ?? '') !== state) { if (state) badge.dataset.state = state; else delete badge.dataset.state; }
    }
  };
  const schedule = () => { if (pending) return; pending = true; (globalThis.queueMicrotask ?? (fn => Promise.resolve().then(fn)))(refresh); };
  root.addEventListener('input', schedule); root.addEventListener('change', schedule);
  if (typeof globalThis.MutationObserver === 'function') {
    const observer = new MutationObserver(schedule);
    for (const id of WATCHED) { const node = $(id); if (node) observer.observe(node, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-state'] }); }
  }
  refresh();
  // ---- filter ----
  const input = $('cp-filter'), status = $('cp-filter-status'), empty = $('cp-filter-empty');
  let saved = null;   // the open state of every section and disclosure before the search started
  const disclosures = () => [...root.querySelectorAll('details.cp-group, details.cp-advanced')];
  const hide = (node, out) => node.classList.toggle('cp-filtered-out', out);
  const clear = () => {
    for (const node of root.querySelectorAll('.cp-filtered-out')) node.classList.remove('cp-filtered-out');
    for (const node of root.querySelectorAll('.cp-filter-hit')) node.classList.remove('cp-filter-hit');
    if (saved) { for (const [node, open] of saved) node.open = open; saved = null; }
    if (empty) empty.hidden = true; if (status) status.textContent = '';
    root.classList.remove('cp-filtering');
  };
  const filter = query => {
    if (!fold(query).trim()) { clear(); return 0; }
    if (!saved) saved = new Map(disclosures().map(node => [node, node.open]));
    root.classList.add('cp-filtering');
    for (const node of root.querySelectorAll('.cp-filter-hit')) node.classList.remove('cp-filter-hit');
    let hits = 0, shownSections = 0;
    for (const section of sections()) {
      const title = searchText(section.querySelector(':scope > summary h3') ?? section);
      const whole = matchesQuery(title, query);
      let sectionHits = 0;
      for (const sub of section.querySelectorAll('.cp-sub')) {
        const subWhole = whole || matchesQuery(searchText(sub), query);
        let subHits = 0;
        for (const item of sub.querySelectorAll(ITEM)) {
          if (item.parentElement?.closest?.(ITEM)) continue;   // a field inside a matched block goes with it
          const hit = subWhole || matchesQuery(searchText(item), query);
          hide(item, !hit);
          if (hit && !subWhole) { item.classList.add('cp-filter-hit'); subHits++; for (const box of item.querySelectorAll('details.cp-advanced')) box.open = true; }
          if (hit && !subWhole) for (let box = item.parentElement; box && box !== sub; box = box.parentElement) if (box.matches('details.cp-advanced')) box.open = true;
        }
        for (const box of sub.querySelectorAll('details.cp-advanced')) hide(box, !subWhole && !box.querySelector(`:is(${ITEM}):not(.cp-filtered-out)`));
        if (subWhole) subHits = Math.max(subHits, 1);
        // a group with no match is hidden whole; in a group matched by its controls, its notes and lists stay (status lines included)
        hide(sub, subHits === 0);
        sectionHits += subHits; hits += subWhole ? 1 : subHits;
      }
      // Execution's foot (Restore defaults) is not a group: it shows when it matches or its section does
      for (const foot of section.querySelectorAll('.cp-reset')) { const hit = whole || matchesQuery(searchText(foot), query); hide(foot, !hit); if (hit && !whole) { sectionHits++; hits++; } }
      hide(section, sectionHits === 0 && !whole);
      if (sectionHits || whole) { section.open = true; shownSections++; }
    }
    if (empty) empty.hidden = hits > 0;
    if (status) status.textContent = hits ? `${plural(hits, 'match', 'matches')} in ${plural(shownSections, 'section')}` : 'No control matches';
    return hits;
  };
  if (input) {
    input.addEventListener('input', () => filter(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && input.value) { event.preventDefault(); input.value = ''; filter(''); }
      else if (event.key === 'Enter') {   // Enter: the first matching control takes the focus
        event.preventDefault();
        const first = [...root.querySelectorAll('.cp-filter-hit, .cp-sub:not(.cp-filtered-out)')].find(node => !node.closest('.cp-filtered-out'));
        const control = first?.querySelector?.('input:not([type=hidden]):not([hidden]), select, textarea, button');
        control?.focus?.();
      }
    });
  }
  return { filter, refresh };
}
