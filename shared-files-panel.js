// "Arquivos do dispositivo" in the Controles panel and the system file picker shown over the phone screen. The tester attaches files from the computer (button or drag and drop); they
// become the virtual device's shared storage (src/shared-storage.js, src/shared-storage-host.js): what the pickers offer and what MediaStore lists. The bytes never leave the browser:
// the page keeps them (IndexedDB when available, so they survive a reload; this page session otherwise) and hands copies to the VM's Worker.
import { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, kindOf, safeName, uniqueName } from './shared-storage.js?v=d8fff06341bc';

const DB_NAME = 'apkweb-shared-storage', STORE = 'files', FIRST_ID = 1001;
const KIND_LABEL = { image: 'imagem', video: 'vídeo', audio: 'áudio', document: 'documento' };
const KIND_ICON = {
  image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z',
  video: 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
  audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
  document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
};
export function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
const formatDuration = ms => { const total = Math.round(ms / 1000); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

/** IndexedDB store of the attached files ({ id, name, mime, size, modified, added, width, height, duration, blob }); null when the browser has none (private mode, blocked storage). */
export function openFileStore({ indexedDB = globalThis.indexedDB } = {}) {
  if (!indexedDB) return null;
  let opening = null;
  const database = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('IndexedDB bloqueado'));
  });
  const run = async (mode, body) => { const db = await database(); return new Promise((resolve, reject) => { const tx = db.transaction(STORE, mode), result = body(tx.objectStore(STORE)); tx.oncomplete = () => resolve(result?.result); tx.onerror = tx.onabort = () => reject(tx.error); }); };
  return { all: () => run('readonly', store => store.getAll()), put: record => run('readwrite', store => store.put(record)), remove: id => run('readwrite', store => store.delete(id)), clear: () => run('readwrite', store => store.clear()) };
}

/** Width / height of an image and duration (ms) / size of a video or audio file, as the device's media scanner would record them; what the browser cannot read stays null. */
async function probe(blob, kind) {
  const out = { width: null, height: null, duration: null };
  try {
    if (kind === 'image' && typeof createImageBitmap === 'function') { const bitmap = await createImageBitmap(blob); out.width = bitmap.width; out.height = bitmap.height; bitmap.close?.(); }
    else if ((kind === 'video' || kind === 'audio') && typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob), element = document.createElement(kind);
      try {
        await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('timeout')), 4000); element.preload = 'metadata'; element.onloadedmetadata = () => { clearTimeout(timer); resolve(); }; element.onerror = () => { clearTimeout(timer); reject(new Error('unreadable')); }; element.src = url; });
        if (Number.isFinite(element.duration)) out.duration = Math.round(element.duration * 1000);
        if (kind === 'video') { out.width = element.videoWidth || null; out.height = element.videoHeight || null; }
      } finally { element.removeAttribute('src'); element.load?.(); URL.revokeObjectURL(url); }
    }
  } catch { /* the browser cannot decode it: the columns stay empty, the bytes are attached all the same */ }
  return out;
}

/**
 * @param $      document.getElementById
 * @param vm     the APKWorkerClient (setSharedFiles, systemPickerResponse, onSystemPickerRequest)
 * @param store  the file store (openFileStore()), or null to keep the files for this page session only
 */
export function createSharedFilesPanel({ $, vm, store = (() => { try { return openFileStore(); } catch { return null; } })() }) {
  const S = { files: [], persisted: !!store, loaded: false, queue: [], open: null, note: '' };
  const total = () => S.files.reduce((sum, file) => sum + file.size, 0);
  const thumb = file => file.thumb ??= file.kind === 'image' ? URL.createObjectURL(file.blob) : null;
  const dropThumb = file => { if (file.thumb) { URL.revokeObjectURL(file.thumb); file.thumb = null; } };
  const meta = file => ({ id: file.id, name: file.name, mime: file.mime, size: file.size, modified: file.modified, added: file.added, width: file.width, height: file.height, duration: file.duration });
  const nextId = () => {
    let stored = 0; try { stored = Number(globalThis.localStorage?.getItem('apkweb-shared-storage-next')) || 0; } catch { /* storage unavailable */ }
    const id = Math.max(FIRST_ID, stored, ...S.files.map(file => file.id + 1));
    try { globalThis.localStorage?.setItem('apkweb-shared-storage-next', String(id + 1)); } catch { /* storage unavailable: ids stay unique within the session */ }
    return id;
  };
  const icon = (kind, className) => { const span = document.createElement('span'); span.className = className; span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${KIND_ICON[kind]}"/></svg>`; return span; };
  const picture = (file, className) => {
    const url = thumb(file); if (!url) return icon(file.kind, className);
    const image = document.createElement('img'); image.className = className; image.alt = ''; image.loading = 'lazy'; image.src = url; return image;
  };
  const details = file => [file.mime || 'tipo pelo nome', formatBytes(file.size), file.width && file.height ? `${file.width}×${file.height}` : '', file.duration ? formatDuration(file.duration) : ''].filter(Boolean).join(' · ');

  function render() {
    const list = $('files-list'); list.replaceChildren();
    for (const file of S.files) {
      const item = document.createElement('li'); item.className = 'files-item';
      const text = document.createElement('span'); text.className = 'files-text';
      const name = document.createElement('span'); name.className = 'files-name'; name.textContent = file.name; name.title = file.name;
      const info = document.createElement('small'); info.textContent = details(file);
      text.append(name, info);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'files-remove'; remove.textContent = 'Remover'; remove.setAttribute('aria-label', `Remover ${file.name}`);
      remove.addEventListener('click', () => removeFile(file.id));
      item.append(picture(file, 'files-thumb'), text, remove); list.append(item);
    }
    list.hidden = S.files.length === 0;
    $('files-summary').textContent = S.files.length ? `${S.files.length} · ${formatBytes(total())}` : 'nenhum';
    $('files-clear').disabled = S.files.length === 0;
    const where = S.persisted ? 'Ficam guardados só neste navegador (IndexedDB) e voltam depois de recarregar a página.' : 'Este navegador não oferece armazenamento agora: os arquivos valem só até a página ser recarregada.';
    $('files-note').textContent = S.note || `Nada é enviado para fora do navegador. ${where} São o armazenamento compartilhado do dispositivo: os seletores de arquivo do Android os oferecem, e o MediaStore lista fotos, vídeos e áudios para o app que tiver a permissão de mídia.`;
  }
  const say = text => { S.note = text; render(); };
  /** Sends a change to the running VM; without one the files go with the next APK (attach). */
  async function push(payload) {
    if (!vm.worker) return;
    try { const reply = await vm.setSharedFiles({ dialogs: true, ...payload }); adopt(reply.files ?? []); }
    catch (error) { say(`A VM não recebeu a mudança dos arquivos (${error.message}). Reabra o APK para o dispositivo virtual ficar igual a esta lista.`); }
  }
  /** The device's view of the files: the type Android resolved for a file the browser gave none for. */
  function adopt(deviceFiles) {
    let changed = false;
    for (const remote of deviceFiles) { const file = S.files.find(item => item.id === remote.id); if (file && !file.mime && remote.mime) { file.mime = remote.mime; file.kind = kindOf(remote.mime); changed = true; } }
    if (changed) render();
  }
  const withBytes = async files => Promise.all(files.map(async file => ({ ...meta(file), bytes: await file.blob.arrayBuffer() })));

  async function addFiles(fileList) {
    const incoming = [...fileList].filter(file => file && typeof file.size === 'number'); if (!incoming.length) return;
    const added = [], refused = []; let bytes = total();
    for (const source of incoming) {
      if (source.size > MAX_FILE_BYTES) { refused.push(`${source.name}: maior que ${MAX_FILE_BYTES / 1048576} MiB`); continue; }
      if (S.files.length + added.length >= MAX_FILES) { refused.push(`${source.name}: limite de ${MAX_FILES} arquivos`); continue; }
      if (bytes + source.size > MAX_TOTAL_BYTES) { refused.push(`${source.name}: limite total de ${MAX_TOTAL_BYTES / 1048576} MiB`); continue; }
      const mime = typeof source.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(source.type) ? source.type.toLowerCase() : '', kind = kindOf(mime);
      const name = uniqueName(safeName(source.name), new Set([...S.files, ...added].map(file => file.name)));
      const file = { id: nextId(), name, mime, kind, size: source.size, modified: Number(source.lastModified) || Date.now(), added: Date.now(), blob: source, thumb: null, ...(await probe(source, kind)) };
      added.push(file); S.files.push(file); bytes += source.size;
    }
    if (store) { try { for (const file of added) await store.put({ ...meta(file), blob: file.blob }); } catch { S.persisted = false; } }
    S.note = refused.length ? `Não anexado: ${refused.join('; ')}.` : added.length ? `${added.length} arquivo(s) anexado(s) ao dispositivo virtual.` : '';
    render();
    if (added.length) await push({ files: await withBytes(added) });
  }
  async function removeFile(id) {
    const index = S.files.findIndex(file => file.id === id); if (index < 0) return;
    const [file] = S.files.splice(index, 1); dropThumb(file);
    if (store) { try { await store.remove(id); } catch { S.persisted = false; } }
    S.note = `${file.name} removido do dispositivo virtual.`; render();
    await push({ remove: [id] });
  }
  async function clearFiles() {
    for (const file of S.files) dropThumb(file); S.files = [];
    if (store) { try { await store.clear(); } catch { S.persisted = false; } }
    S.note = 'Todos os arquivos foram removidos do dispositivo virtual.'; render();
    await push({ replace: true, files: [] });
  }
  const loading = (async () => {
    if (store) {
      try { for (const record of (await store.all()) ?? []) if (record?.blob && Number.isSafeInteger(record.id)) S.files.push({ ...record, mime: record.mime ?? '', kind: kindOf(record.mime), thumb: null }); S.files.sort((a, b) => a.id - b.id); }
      catch { S.persisted = false; }
    }
    S.loaded = true; render();
  })();

  // ---- the controls ----
  const input = $('files-input'), drop = $('files-drop');
  $('files-add').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const chosen = [...input.files]; input.value = ''; addFiles(chosen); });
  for (const name of ['dragenter', 'dragover']) drop.addEventListener(name, event => { if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', event => { if (!drop.contains(event.relatedTarget)) drop.classList.remove('dragging'); });
  drop.addEventListener('drop', event => { if (!event.dataTransfer?.files?.length) return; event.preventDefault(); event.stopPropagation(); drop.classList.remove('dragging'); addFiles(event.dataTransfer.files); });
  $('files-clear').addEventListener('click', () => clearFiles());

  // ---- the system picker over the phone ----
  const scrim = () => $('system-picker');
  const FILTER_TEXT = filters => filters.includes('*/*') ? 'qualquer arquivo' : filters.join(', ');
  function closeDialog() {
    const dialog = scrim(); dialog.hidden = true; dialog.onkeydown = null; dialog.replaceChildren();
    const content = $('android-content'), layer = $('android-window-layer'); if (S.open?.inertBefore) { content.inert = S.open.inertBefore.content; layer.inert = S.open.inertBefore.layer; }
    const focusBack = S.open?.focusBack; S.open = null; try { focusBack?.focus?.(); } catch { /* the element is gone */ }
  }
  function answer(selected) { const request = S.open.request; closeDialog(); S.queue.shift(); vm.systemPickerResponse(request.id, selected); showNext(); }
  function showNext() {
    if (S.open || !S.queue.length) return;
    const request = S.queue[0], dialog = scrim(), content = $('android-content'), layer = $('android-window-layer'), chosen = [];
    S.open = { request, focusBack: document.activeElement, inertBefore: { content: content.inert, layer: layer.inert } }; content.inert = true; layer.inert = true;   // modal: the app below does not take input
    dialog.classList.toggle('dark', !!document.getElementById('dev-dark')?.checked); dialog.classList.toggle('sp-photos', request.picker !== 'documents');
    const card = document.createElement('div'); card.className = 'sp-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'sp-title'); card.tabIndex = -1;
    const title = document.createElement('h2'); title.id = 'sp-title'; title.className = 'sp-title'; title.textContent = request.title;
    const hint = document.createElement('p'); hint.className = 'sp-hint';
    hint.textContent = `${request.multiple ? (request.max > 1 ? `Escolha até ${request.max} itens` : 'Escolha um ou mais itens') : 'Escolha um item'} · ${FILTER_TEXT(request.filters)}`;
    const list = document.createElement('ul'); list.className = 'sp-list'; list.setAttribute('aria-label', 'Arquivos do dispositivo');
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.id = 'sp-confirm'; confirm.className = 'sp-button sp-primary'; confirm.hidden = !request.multiple;
    const refresh = () => { confirm.textContent = chosen.length ? `Selecionar (${chosen.length})` : 'Selecionar'; confirm.disabled = chosen.length === 0; };
    for (const offered of request.files) {
      const file = S.files.find(item => item.id === offered.id) ?? { ...offered, kind: kindOf(offered.mime), blob: null, thumb: null };
      const item = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.className = 'sp-item'; button.dataset.fileId = String(offered.id);
      if (request.multiple) button.setAttribute('aria-pressed', 'false');
      const text = document.createElement('span'); text.className = 'sp-text';
      const name = document.createElement('span'); name.className = 'sp-name'; name.textContent = offered.name;
      const info = document.createElement('small'); info.textContent = [offered.mime, formatBytes(offered.size)].join(' · ');
      text.append(name, info); button.append(file.blob ? picture(file, 'sp-thumb') : icon(file.kind, 'sp-thumb'), text);
      button.addEventListener('click', () => {
        if (!request.multiple) { answer([offered.id]); return; }
        const at = chosen.indexOf(offered.id);
        if (at >= 0) chosen.splice(at, 1); else if (request.max > 1 && chosen.length >= request.max) return; else chosen.push(offered.id);
        button.setAttribute('aria-pressed', chosen.includes(offered.id) ? 'true' : 'false'); refresh();
      });
      item.append(button); list.append(item);
    }
    const empty = document.createElement('p'); empty.className = 'sp-empty'; empty.hidden = request.files.length > 0;
    empty.textContent = request.total === 0 ? 'O dispositivo não tem arquivos. Anexe arquivos em Controles › Arquivos do dispositivo e peça de novo no app.' : 'Nenhum arquivo do dispositivo corresponde ao tipo que o app pediu.';
    const others = document.createElement('p'); others.className = 'sp-others'; others.hidden = !(request.others > 0 && request.files.length > 0);
    others.textContent = `${request.others} arquivo(s) do dispositivo não aparecem: o tipo não corresponde ao pedido do app.`;
    const actions = document.createElement('div'); actions.className = 'sp-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'sp-cancel'; cancel.className = 'sp-button'; cancel.textContent = 'Cancelar';
    cancel.addEventListener('click', () => answer(null)); confirm.addEventListener('click', () => answer([...chosen]));
    actions.append(cancel, confirm); refresh();
    card.append(title, hint, list, empty, others, actions); dialog.replaceChildren(card);
    dialog.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); answer(null); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...card.querySelectorAll('button:not([hidden]):not(:disabled)')], first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.hidden = false; (card.querySelector('.sp-item') ?? cancel).focus();
  }
  vm.onSystemPickerRequest = request => { S.queue.push(request); showNext(); };

  render();
  return {
    /** The APK was loaded: the device's shared storage gets the files before the app runs, and the VM learns that this page shows the picker. */
    async attach() {
      if (S.open) closeDialog(); S.queue.length = 0; await loading;
      if (!vm.worker) return;
      try { const reply = await vm.setSharedFiles({ dialogs: true, replace: true, files: await withBytes(S.files) }); adopt(reply.files ?? []); }
      catch (error) { say(`A VM não recebeu os arquivos do dispositivo (${error.message}).`); }
    },
    /** The VM went away (reopen, stop): a picker that waited for it has nothing to answer. */
    detach() { if (S.open) closeDialog(); S.queue.length = 0; },
    addFiles, removeFile, clearFiles, ready: loading,
    get state() { return S; },
  };
}
