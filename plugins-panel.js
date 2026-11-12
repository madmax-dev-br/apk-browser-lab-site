// The "Plugins" section of the Controles panel and the "Plugins" output panel under the device (docs/PLUGINS.md). The section lists the plugins (on/off, name, status, Editar,
// Remover, order, export / import) and the dialog edits one (name, output options, code; a stored package filter is kept, not edited); the list lives in localStorage (src/plugin-store.js) and is handed to the host
// (src/plugin-host.js), which runs each enabled plugin in its own Worker. The output panel shows one card per running or failed plugin: its blocks (rendered with textContent
// and DOM building only, never HTML), badge, console and errors, with Parar / Reiniciar. Renders are coalesced (at most every RENDER_MS) and skipped while the panel is closed.
import { RENDER_MS } from './plugin-host.js?v=f0166ffeffb5';
import { syncButtons, buttonItems } from './plugin-buttons.js?v=f0166ffeffb5';
import { MAX_PLUGINS, normalizePlugin, validatePlugin, loadPlugins, savePlugins, exportPlugins, importPlugins, blankPlugin } from './plugin-store.js?v=f0166ffeffb5';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const STATUS_LABEL = { rodando: 'rodando', iniciando: 'iniciando', parado: 'parado', erro: 'erro' };
const pad = value => String(value).padStart(2, '0');
const stamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
export const pluginsFileName = (date = new Date()) => `plugins-${stamp(date)}.json`;
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** A Tab in the code editor inserts two spaces (Shift+Tab removes up to two before the caret); returns whether the key was handled. */
export function editorKey(textarea, event) {
  if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return false;
  event.preventDefault?.();
  const start = textarea.selectionStart ?? textarea.value.length, end = textarea.selectionEnd ?? start, value = textarea.value;
  if (event.shiftKey) { const lineStart = value.lastIndexOf('\n', start - 1) + 1, remove = value.slice(lineStart, lineStart + 2).match(/^ {1,2}/)?.[0].length ?? 0; if (remove) { textarea.value = value.slice(0, lineStart) + value.slice(lineStart + remove); textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - remove); } return true; }
  textarea.value = value.slice(0, start) + '  ' + value.slice(end); textarea.selectionStart = textarea.selectionEnd = start + 2; return true;
}

/** DOM of one output block (text only). */
export function renderBlock(doc, block) {
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  if (block.kind === 'text') return el('pre', 'po-text', block.text);
  if (block.kind === 'json') return el('pre', 'po-json', block.text);
  if (block.kind === 'kv') { const dl = el('dl', 'po-kv'); for (const [key, value] of block.entries) dl.append(el('dt', '', key), el('dd', '', value)); return dl; }
  if (block.kind === 'table') {
    const wrap = el('div', 'po-table-wrap'), table = el('table', 'po-table'), head = el('thead'), row = el('tr'), body = el('tbody');
    for (const column of block.columns) row.append(el('th', '', column)); head.append(row);
    for (const cells of block.rows) { const tr = el('tr'); for (const cell of cells) tr.append(el('td', '', cell)); body.append(tr); }
    if (!block.rows.length) { const tr = el('tr'), td = el('td', 'po-empty', 'Sem linhas.'); td.setAttribute('colspan', String(Math.max(1, block.columns.length))); tr.append(td); body.append(tr); }
    table.append(head, body); wrap.append(table); return wrap;
  }
  if (block.kind === 'image') {
    const figure = el('figure', 'po-image'), image = el('img'); image.alt = block.caption || 'Imagem do plugin'; image.decoding = 'async';
    image.src = imageURL(block.blob); if (block.width) image.width = block.width; if (block.height) image.height = block.height;
    figure.append(image); if (block.caption) figure.append(el('figcaption', '', block.caption)); return figure;
  }
  return el('pre', 'po-text', '');
}
// One object URL per image Blob while a block shows it; releaseImages() revokes the URLs of Blobs no block holds anymore.
const imageURLs = new Map();
function imageURL(blob) { let url = imageURLs.get(blob); if (!url) { url = URL.createObjectURL(blob); imageURLs.set(blob, url); } return url; }
export function releaseImages(liveBlobs) { for (const [blob, url] of imageURLs) if (!liveBlobs.has(blob)) { URL.revokeObjectURL(url); imageURLs.delete(blob); } }

export function createPluginsPanel({ $, host, save = download, outputRoot = $('plugins-output'), toolbarRoot = null, setTimer = (fn, ms) => setTimeout(fn, ms), now = () => performance.now(), modals = null }) {
  const S = { plugins: loadPlugins(), editing: null, opener: null, submitted: false, dirty: new Set(), timer: null, lastRender: -Infinity, cards: new Map(), open: new Set() };
  const doc = outputRoot?.ownerDocument ?? globalThis.document;
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const button = (text, className, label, onClick) => { const node = el('button', `cp-button ${className}`, text); node.type = 'button'; if (label) node.setAttribute('aria-label', label); node.addEventListener('click', onClick); return node; };
  // the plugins' own buttons (lab.button, src/plugin-buttons.js): a click runs the plugin's handler; the host marks the button busy until it finishes
  const clickButton = (pluginId, buttonId) => { host.clickButton?.(pluginId, buttonId)?.then?.(() => schedule(pluginId), () => schedule(pluginId)); schedule(pluginId); };
  const buttonGroup = label => { const group = el('div', 'pb-row'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label); group.hidden = true; return group; };
  /** The preview bar's plugin buttons (placement 'toolbar'), in plugin order. */
  function renderToolbar() { if (toolbarRoot) syncButtons(toolbarRoot, S.plugins.flatMap(plugin => buttonItems(plugin, host.get(plugin.id), 'toolbar')), { onClick: clickButton, toolbar: true }); }
  const statusOf = plugin => { const live = host.get(plugin.id); return live ? { status: live.status, reason: live.reason, errors: live.errorCount, badge: live.output?.badge ?? '' } : { status: 'parado', reason: plugin.enabled ? '' : 'desligado', errors: 0, badge: '' }; };

  // ---- the section list -----------------------------------------------------------------------------------------------------------------------------------------------
  function meta(plugin) {
    const { status, reason, errors } = statusOf(plugin);
    const parts = [STATUS_LABEL[status] ?? status]; if (reason && status !== 'rodando') parts.push(reason); if (plugin.packageFilter) parts.push(`pacote ${plugin.packageFilter}`); if (errors) parts.push(`${errors} ${errors === 1 ? 'erro' : 'erros'}`);
    return [parts.join(' · '), status === 'erro' ? 'error' : status === 'rodando' ? 'ok' : ''];
  }
  function updateMeta() {
    [...$('pl-list').children].forEach((li, index) => {
      const plugin = S.plugins[index]; if (!plugin) return; const [text, state] = meta(plugin), info = li.querySelector('.em-meta'); if (info) { info.textContent = text; info.dataset.state = state; }
      syncButtons(li.querySelector('.pb-row'), buttonItems(plugin, host.get(plugin.id), 'plugin'), { onClick: clickButton });
    });
    renderToolbar();
    const runningCount = host.runningCount;
    $('pl-summary').textContent = `${runningCount} rodando`;
    $('pl-status').textContent = !S.plugins.length ? 'Nenhum plugin. Clique em + Adicionar.' : `${S.plugins.length} ${S.plugins.length === 1 ? 'plugin' : 'plugins'}, ${runningCount} rodando.${runningCount ? ' A saída aparece no painel Plugins abaixo do aparelho.' : ''}`;
    $('pl-export').disabled = !S.plugins.length;
    if (outputRoot) { outputRoot.hidden = !S.plugins.length; const count = outputRoot.querySelector('.po-count'); if (count) count.textContent = `${runningCount} rodando`; }
  }
  function renderList() {
    $('pl-list').replaceChildren(...S.plugins.map((plugin, index) => {
      const li = el('li', 'em-row pl-row'), n = index + 1;
      const check = el('input'); check.type = 'checkbox'; check.checked = plugin.enabled; check.setAttribute('aria-label', `Ligar o plugin ${n}: ${plugin.name}`);
      check.addEventListener('change', () => { plugin.enabled = check.checked; changed(); });
      const what = el('span', 'em-what'); what.append(el('b', 'pl-name', plugin.name));
      const actions = el('span', 'em-row-actions');
      actions.append(button('↑', 'em-up', `Subir o plugin ${n}`, () => move(index, -1)), button('↓', 'em-down', `Descer o plugin ${n}`, () => move(index, 1)),
        button('Editar', 'em-edit', `Editar o plugin ${n}: ${plugin.name}`, event => openDialog(plugin, event.currentTarget)),
        button('Remover', 'em-remove', `Remover o plugin ${n}: ${plugin.name}`, () => { if (!globalThis.confirm || globalThis.confirm(`Remover o plugin "${plugin.name}"?`)) { S.plugins.splice(index, 1); changed(); $('pl-add').focus(); } }));
      actions.children[0].disabled = index === 0; actions.children[1].disabled = index === S.plugins.length - 1;
      const info = el('span', 'em-meta'); info.setAttribute('role', 'status');
      li.append(check, what, actions, info, buttonGroup(`Botões do plugin ${plugin.name}`)); return li;
    }));
    updateMeta();
  }
  function move(index, by) {
    const to = index + by; if (to < 0 || to >= S.plugins.length) return;
    const [item] = S.plugins.splice(index, 1); S.plugins.splice(to, 0, item); changed();
    $('pl-list').children[to]?.querySelector(by < 0 ? '.em-up' : '.em-down')?.focus();
  }
  function changed() { savePlugins(S.plugins); host.setPlugins(S.plugins); renderList(); renderOutput(true); }

  // ---- the dialog -----------------------------------------------------------------------------------------------------------------------------------------------------
  function showErrors() {
    const { errors } = validatePlugin({ name: $('pl-name').value, code: $('pl-code').value });
    for (const field of ['name', 'code']) { const node = $(`pl-err-${field}`), list = S.submitted ? errors.filter(error => error.field === field) : []; node.textContent = list.map(error => error.message).join(' '); node.hidden = !node.textContent; }
    return errors;
  }
  // The dialog has no package field. A plugin saved or imported with a package filter keeps it (the host still honours it, the list row shows it): the dialog only says so
  // and offers to drop the restriction; a new plugin applies to any app.
  function showPackage(filter) {
    S.packageFilter = String(filter ?? ''); const note = $('pl-package-note'); if (!note) return;
    note.hidden = !S.packageFilter; const text = $('pl-package-text'); if (text) text.textContent = S.packageFilter ? `Este plugin só roda quando o pacote aberto é ${S.packageFilter}.` : '';
  }
  $('pl-package-clear')?.addEventListener('click', () => { showPackage(''); $('pl-name').focus?.(); });
  function openDialog(plugin, opener, draft = null) {
    S.editing = plugin ? plugin.id : null; S.opener = opener ?? doc.activeElement; S.submitted = false;
    const data = plugin ?? draft ?? blankPlugin();
    $('pl-dialog-title').textContent = plugin ? 'Editar plugin' : 'Adicionar plugin';
    $('pl-name').value = data.name; showPackage(data.packageFilter ?? ''); $('pl-code').value = data.code; S.draft = data; showErrors();
    const fixed = typeof data.height === 'number';
    $('pl-updates').value = data.updates === 'manual' ? 'manual' : 'auto'; $('pl-height').value = fixed ? 'fixed' : (data.height ?? 'wrap'); $('pl-height-px').value = String(fixed ? data.height : 240); $('pl-height-px').hidden = !fixed;
    $('pl-dialog').hidden = false; doc.body?.classList?.add('em-modal-open');
    for (const node of doc.querySelectorAll?.('main, header') ?? []) node.inert = true;
    $('pl-code').focus?.();
  }
  function closeDialog() {
    if ($('pl-dialog').hidden) return;
    $('pl-dialog').hidden = true; doc.body?.classList?.remove('em-modal-open');
    for (const node of doc.querySelectorAll?.('main, header') ?? []) node.inert = false;
    const opener = S.opener; S.editing = null; S.opener = null; S.draft = null;
    if (opener?.isConnected) opener.focus(); else $('pl-add').focus?.();
  }
  function submit(event) {
    event?.preventDefault?.(); S.submitted = true;
    if (showErrors().length) { (validatePlugin({ name: $('pl-name').value, code: '' }).errors.some(e => e.field === 'name') ? $('pl-name') : $('pl-code')).focus?.(); return; }
    const at = S.plugins.findIndex(item => item.id === S.editing), base = at >= 0 ? S.plugins[at] : S.draft;
    const plugin = normalizePlugin({ ...base, name: $('pl-name').value, packageFilter: S.packageFilter, code: $('pl-code').value,
      updates: $('pl-updates').value, height: $('pl-height').value === 'fixed' ? Number($('pl-height-px').value) || 240 : $('pl-height').value });   // display options: never restart the plugin
    if (at >= 0) S.plugins[at] = plugin;
    else { if (S.plugins.length >= MAX_PLUGINS) { $('pl-err-code').textContent = `No máximo ${MAX_PLUGINS} plugins.`; $('pl-err-code').hidden = false; return; } S.plugins.push(plugin); }
    closeDialog(); if (outputRoot && plugin.enabled) outputRoot.open = true;   // its output shows at once
    changed();
  }
  $('pl-dialog').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (event.target === $('pl-code') && editorKey($('pl-code'), event)) return;
    if (event.key !== 'Tab') return;
    const items = [...$('pl-dialog').querySelectorAll(FOCUSABLE)].filter(node => !node.hidden && node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  $('pl-dialog').addEventListener('mousedown', event => { if (event.target === $('pl-dialog')) event.preventDefault(); });
  $('pl-form').addEventListener('submit', submit);
  $('pl-height').addEventListener('change', () => { $('pl-height-px').hidden = $('pl-height').value !== 'fixed'; });
  $('pl-cancel').addEventListener('click', closeDialog);
  $('pl-close').addEventListener('click', closeDialog);
  for (const id of ['pl-name', 'pl-code']) $(id).addEventListener('input', showErrors);

  // ---- section buttons ------------------------------------------------------------------------------------------------------------------------------------------------
  $('pl-add').addEventListener('click', event => {
    if (S.plugins.length >= MAX_PLUGINS) { $('pl-status').textContent = `No máximo ${MAX_PLUGINS} plugins.`; return; }
    openDialog(null, event.currentTarget, blankPlugin());   // always blank: the examples are in plugins.html#exemplos
  });
  $('pl-export').addEventListener('click', () => { if (S.plugins.length) save(pluginsFileName(), exportPlugins(S.plugins), 'application/json'); });
  $('pl-import').addEventListener('click', () => $('pl-import-file').click());
  $('pl-import-file').addEventListener('change', async () => {
    const file = $('pl-import-file').files?.[0]; $('pl-import-file').value = ''; if (!file) return;
    let text; try { text = await file.text(); } catch (error) { $('pl-status').textContent = `O arquivo não pôde ser lido: ${error?.message ?? error}`; return; }
    const { plugins, error } = importPlugins(text), room = MAX_PLUGINS - S.plugins.length, added = plugins.slice(0, Math.max(0, room));
    S.plugins.push(...added); changed();
    $('pl-status').textContent = `${added.length} ${added.length === 1 ? 'plugin importado' : 'plugins importados'} de ${file.name}, desligados: revise o código e ligue.${error ? ' ' + error : ''}${plugins.length > added.length ? ` A lista chegou ao máximo de ${MAX_PLUGINS}.` : ''}`;
  });

  // ---- output cards ---------------------------------------------------------------------------------------------------------------------------------------------------
  // Each card is a <details>, collapsed on every page load (S.open: the ones the viewer opened since); a closed card only updates its header (status, badge, "novos dados").
  // Display settings live with the plugin (plugin-store.js): updates 'auto' (the blocks follow the plugin) or 'manual' (they hold until Atualizar), and the block height.
  // Display options come from the plugin (set when creating / editing it, plugin-store.js): updates 'auto' or 'manual' and the block height. The card stays simple.
  const REFRESH_WAIT_MS = 5000, REFRESH_MIN_MS = 350;
  function setLoading(entry, on) {
    entry.refresh.classList.toggle('is-loading', on); entry.refresh.disabled = on || !host.get(entry.id)?.worker;
    entry.refresh.textContent = on ? 'Atualizando…' : 'Atualizar'; entry.refresh.setAttribute('aria-busy', on ? 'true' : 'false');
  }
  function applyDisplay(entry, plugin) {
    const fixed = typeof plugin.height === 'number';
    entry.root.dataset.height = fixed ? 'fixed' : plugin.height; entry.root.style.setProperty('--po-h', fixed ? `${plugin.height}px` : ''); entry.root.dataset.updates = plugin.updates;
  }
  /** Replaces the block DOM keeping what the viewer did: a block with the same id is updated in place (text / JSON) or rebuilt with its scroll position restored. */
  function patchBlocks(container, blocks) {
    const old = new Map(), scroll = new Map();
    for (const node of container.children) { if (node.dataset?.key) old.set(node.dataset.key, node); if (node.scrollTop || node.scrollLeft) scroll.set(node.dataset?.key ?? '', { top: node.scrollTop, left: node.scrollLeft }); }
    const nodes = blocks.map((block, index) => {
      const key = block.id !== null && block.id !== undefined ? `id:${block.id}` : `#${index}`, previous = old.get(key);
      if (previous && previous.block === block) return previous;
      if (previous && previous.block?.kind === block.kind && (block.kind === 'text' || block.kind === 'json')) { if (previous.textContent !== block.text) previous.textContent = block.text; previous.block = block; return previous; }
      const node = renderBlock(doc, block); node.dataset.key = key; node.block = block; return node;
    });
    if (nodes.length !== container.children.length || nodes.some((node, index) => container.children[index] !== node)) container.replaceChildren(...nodes);
    for (const node of nodes) { const at = scroll.get(node.dataset.key); if (at && (node.scrollTop !== at.top || node.scrollLeft !== at.left)) { node.scrollTop = at.top; node.scrollLeft = at.left; } }   // a node moved in the DOM lost its scroll
  }
  function card(plugin) {
    let entry = S.cards.get(plugin.id);
    if (!entry) {
      const root = el('details', 'po-card'), head = el('summary', 'po-head'), name = el('b', 'po-name'), status = el('span', 'po-status'), badge = el('span', 'po-badge'), fresh = el('span', 'po-fresh', 'novos dados');
      fresh.hidden = true;
      const tools = el('div', 'po-tools');
      const refresh = button('Atualizar', 'po-refresh', `Atualizar a saída de ${plugin.name}`, () => {
        const current = S.cards.get(plugin.id); if (!current || current.loading) return;
        const listens = host.refresh?.(plugin.id) === true, started = now();
        // loading until the plugin writes new output (a plugin with lab.on('refresh')), at most REFRESH_WAIT_MS; a plugin that does not listen just redraws (a short blink)
        current.loading = { base: [...(host.get(plugin.id)?.output?.blocks ?? [])], until: started + (listens ? REFRESH_WAIT_MS : REFRESH_MIN_MS), minUntil: started + REFRESH_MIN_MS, listens };
        current.force = true; current.acceptUntil = started + (listens ? REFRESH_WAIT_MS : 1500);   // manual mode: the output the refresh produces shows too
        setLoading(current, true); schedule(plugin.id);
        setTimer(() => { const entry = S.cards.get(plugin.id); if (entry?.loading) { entry.loading = null; setLoading(entry, false); } }, listens ? REFRESH_WAIT_MS : REFRESH_MIN_MS);
      });
      const stop = button('Parar', 'po-stop', `Parar o plugin ${plugin.name}`, () => { host.stop(plugin.id); schedule(plugin.id); }), restart = button('Reiniciar', 'po-restart', `Reiniciar o plugin ${plugin.name}`, () => { host.restart(plugin.id); schedule(plugin.id); });
      const expand = button('⤢ Expandir', 'po-expand', `Abrir a saída de ${plugin.name} numa janela grande`, () => {
        const current = S.cards.get(plugin.id); if (!current || !modals) return;
        if (current.expanded) { current.expanded.modal.close('code'); return; }
        const container = el('div', 'po-blocks po-expanded'); container.dataset.height = 'auto';
        const modal = modals.open({ title: plugin.name, size: 'full', content: container, label: 'saída do plugin', onClose: () => { const entry = S.cards.get(plugin.id); if (entry) entry.expanded = null; } });
        current.expanded = { modal, container }; current.force = true; schedule(plugin.id);
      });
      expand.hidden = !modals;
      tools.append(refresh, expand, stop, restart);
      const actions = buttonGroup(`Botões do plugin ${plugin.name}`);
      const blocks = el('div', 'po-blocks'), errors = el('div', 'po-errors'), consoleBox = el('details', 'po-console'), consoleSummary = el('summary', '', 'Console'), consoleLines = el('div', 'po-console-lines');
      consoleBox.append(consoleSummary, consoleLines); head.append(name, status, badge, fresh); root.append(head, tools, actions, errors, blocks, consoleBox);
      root.open = S.open.has(plugin.id);
      root.addEventListener('toggle', () => { if (root.open) { S.open.add(plugin.id); const current = S.cards.get(plugin.id); if (current) current.force = true; schedule(plugin.id); } else S.open.delete(plugin.id); });
      entry = { id: plugin.id, root, name, status, badge, fresh, refresh, stop, restart, actions, blocks, errors, consoleBox, consoleSummary, consoleLines, consoleCount: -1, errorCount: -1, force: true, acceptUntil: 0 };
      S.cards.set(plugin.id, entry);
    }
    const live = host.get(plugin.id), status = live?.status ?? 'parado';
    entry.name.textContent = plugin.name; entry.status.textContent = STATUS_LABEL[status] ?? status; entry.status.dataset.state = status; entry.root.dataset.state = status;
    entry.badge.textContent = live?.output?.badge ?? ''; entry.badge.hidden = !entry.badge.textContent;
    entry.stop.disabled = !live?.worker; entry.restart.disabled = !plugin.enabled; entry.refresh.disabled = !live?.worker || !!entry.loading;
    applyDisplay(entry, plugin);
    syncButtons(entry.actions, buttonItems(plugin, live, 'plugin'), { onClick: clickButton });
    if (live) {
      const blocks = live.output.blocks, changedBlocks = entry.force || entry.lastStatus !== status || !entry.lastBlocks || blocks.length !== entry.lastBlocks.length || blocks.some((block, index) => entry.lastBlocks[index] !== block);
      const hold = plugin.updates === 'manual' && entry.lastBlocks && !entry.force && now() > entry.acceptUntil && entry.lastStatus === status;
      const visible = entry.root.open || !!entry.expanded;
      if (changedBlocks && (hold || !visible)) entry.pending = true;   // closed or manual: shown later (on open / Atualizar)
      else if (changedBlocks && visible) {
        patchBlocks(entry.blocks, blocks); if (entry.expanded) patchBlocks(entry.expanded.container, blocks); entry.lastBlocks = [...blocks]; entry.lastStatus = status; entry.pending = false; entry.force = false;
        if (!blocks.length) entry.blocks.replaceChildren(el('p', 'po-empty', status === 'rodando' ? 'Sem saída ainda (use lab.ui.text, kv, table ou json).' : status === 'erro' ? 'O plugin parou com erro.' : 'Plugin parado.'));
      }
      entry.fresh.hidden = !(entry.pending && plugin.updates === 'manual'); entry.refresh.classList.toggle('has-news', !entry.fresh.hidden);
      if (entry.loading?.listens) {   // the refresh produced new output: done (after a minimum so the state is seen)
        const base = entry.loading.base, changed = blocks.length !== base.length || blocks.some((block, index) => base[index] !== block);
        if (changed) { const wait = entry.loading.minUntil - now(); if (wait <= 0) { entry.loading = null; setLoading(entry, false); } else setTimer(() => schedule(plugin.id), wait); }
      }
      if (entry.root.open && (entry.errorCount !== live.errors.length || entry.errorsRef !== live.errors[live.errors.length - 1])) {
        entry.errors.replaceChildren(...live.errors.slice(-5).map(error => { const item = el('pre', 'po-error', `${error.phase}: ${error.message}${error.stack ? '\n' + error.stack : ''}`); return item; }));
        entry.errorCount = live.errors.length; entry.errorsRef = live.errors[live.errors.length - 1];
      }
      if (entry.consoleCount !== live.console.length || entry.consoleRef !== live.console[live.console.length - 1]) {
        entry.consoleSummary.textContent = `Console (${live.console.length})`;
        if (entry.consoleBox.open) entry.consoleLines.replaceChildren(...live.console.map(line => { const row = el('div', `po-console-line level-${line.level}`, line.text); return row; }));
        entry.consoleCount = live.console.length; entry.consoleRef = live.console[live.console.length - 1];
      }
      entry.consoleBox.hidden = !live.console.length;
    }
    return entry.root;
  }
  function renderOutput(all = false) {
    S.timer = null; S.lastRender = now();
    updateMeta();
    if (!outputRoot || !outputRoot.open) {   // closed: no DOM work, except a plugin opened large (Expandir), which keeps following its plugin
      for (const plugin of S.plugins) { const entry = S.cards.get(plugin.id); if (entry?.expanded && (all || S.dirty.has(plugin.id))) card(plugin); }
      S.dirty.clear(); return;
    }
    const container = outputRoot.querySelector('.po-cards'); if (!container) return;
    const shown = S.plugins.filter(plugin => plugin.enabled || host.get(plugin.id)?.worker || host.get(plugin.id)?.status === 'erro');
    for (const id of [...S.cards.keys()]) if (!shown.some(plugin => plugin.id === id)) S.cards.delete(id);
    const cards = shown.map(plugin => (all || S.dirty.has(plugin.id) || !S.cards.has(plugin.id)) ? card(plugin) : S.cards.get(plugin.id).root);
    S.dirty.clear();
    if (cards.length !== container.children.length || cards.some((node, index) => container.children[index] !== node)) container.replaceChildren(...cards);
    if (typeof URL?.revokeObjectURL === 'function') releaseImages(new Set((host.list?.() ?? []).flatMap(plugin => plugin.output?.blocks ?? []).filter(block => block.kind === 'image').map(block => block.blob)));
    if (!cards.length) container.replaceChildren(el('p', 'po-empty', S.plugins.length ? 'Nenhum plugin ligado. Ligue um na seção Plugins dos Controles.' : 'Nenhum plugin.'));
  }
  function schedule(id) {
    if (id) S.dirty.add(id);
    if (S.timer !== null) return;
    S.timer = setTimer(() => renderOutput(false), Math.max(0, S.lastRender + RENDER_MS - now()));
  }
  outputRoot?.addEventListener('toggle', () => { if (outputRoot.open) renderOutput(true); });
  // a console <details> opening shows its lines (they are not rendered while closed)
  outputRoot?.addEventListener('click', event => { const box = event.target?.closest?.('.po-console'); if (box) setTimer(() => { for (const [id, entry] of S.cards) if (entry.consoleBox === box) { entry.consoleCount = -1; schedule(id); } }, 0); });

  host.setPlugins(S.plugins); renderList();
  return {
    /** The host reports a change of one plugin (status, output, console): rendered at most every RENDER_MS. */
    changed: id => schedule(id),
    /** The open package changed: the host re-evaluates the package filters. */
    refresh() { updateMeta(); schedule(); },
    open: openDialog,
    get state() { return S; },
  };
}
