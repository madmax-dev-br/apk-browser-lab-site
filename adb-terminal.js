// The adb terminal of the tool dock: a command line that only runs adb. What is typed goes to the page's adb interpreter (src/adb-commands.js: the same one the MCP tool `adb`
// uses), and what the command prints comes back above it: the output, an image for `screencap`, the exit status when it is not 0, and the lab's notes on how the page served
// the command. A browser page has no file system: `adb install x.apk` and `adb push x …` ask the person for the file with the browser's own file picker, and `adb pull` and
// `> file` hand the result over as a download. `clear` empties the screen; the history of commands is kept in this browser (arrow up / down). No process.*.

const HISTORY_KEY = 'apkweb-adb-history-v1', HISTORY_LIMIT = 60;
/** The command history: newest last, no immediate repeats, bounded, kept in storage when the browser allows it. */
export function createCommandHistory({ storage = (() => { try { return globalThis.localStorage; } catch { return null; } })(), limit = HISTORY_LIMIT } = {}) {
  let list = []; try { const saved = JSON.parse(storage?.getItem(HISTORY_KEY) ?? '[]'); if (Array.isArray(saved)) list = saved.filter(item => typeof item === 'string' && item.trim()).slice(-limit); } catch { list = []; }
  let cursor = list.length, draft = '';
  return {
    get list() { return [...list]; },
    add(command) { const text = String(command ?? '').trim(); if (text && list.at(-1) !== text) { list.push(text); if (list.length > limit) list = list.slice(-limit); try { storage?.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* storage full or blocked: the history lasts for this page */ } } cursor = list.length; draft = ''; },
    /** Arrow up: the previous command (`typed`: what is in the field now, kept to come back to with arrow down). */
    previous(typed) { if (cursor === list.length) draft = typed; if (cursor > 0) cursor--; return list[cursor] ?? typed; },
    next() { if (cursor < list.length) cursor++; return cursor === list.length ? draft : list[cursor]; },
  };
}
/** What a finished command shows, as lines of the terminal: [{ kind: 'out' | 'error' | 'note' | 'image' | 'hint', text | blob }]. */
export function resultLines(result) {
  const lines = [];
  for (const picture of result?.images ?? []) lines.push({ kind: 'image', blob: picture.blob });
  if (result?.stdout) lines.push({ kind: 'out', text: result.stdout.replace(/\n$/, '') });
  if (result?.stderr) lines.push({ kind: 'error', text: result.stderr.replace(/\n$/, '') });
  for (const note of result?.notes ?? []) lines.push({ kind: 'note', text: note });
  if (result && result.code !== 0) lines.push({ kind: 'hint', text: `status ${result.code}` });
  return lines;
}
const baseName = path => String(path ?? '').replace(/^pull:/, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'arquivo';

/**
 * root: the terminal's <details> (index.html #adb-terminal: .adb-output, .adb-form with .adb-input, .adb-file, .adb-clear, .adb-count).
 * run(command, io) -> the interpreter's result ({ stdout, stderr, code, images, notes }). Returns { execute(command), clear(), focus() }.
 */
export function createAdbTerminal({ root, run, doc = globalThis.document, history = createCommandHistory(), onCommand = () => {} }) {
  const output = root.querySelector('.adb-output'), form = root.querySelector('.adb-form'), input = root.querySelector('.adb-input'), picker = root.querySelector('.adb-file'), counter = root.querySelector('.adb-count');
  let busy = false, commands = 0;
  const print = (kind, text) => { const line = doc.createElement('div'); line.className = `adb-line adb-${kind}`; line.textContent = text; output.append(line); output.scrollTop = output.scrollHeight; return line; };
  const picture = blob => { const image = doc.createElement('img'); image.className = 'adb-image'; image.alt = 'Imagem devolvida pelo comando'; image.src = URL.createObjectURL(blob); image.addEventListener('load', () => { output.scrollTop = output.scrollHeight; }); output.append(image); };
  /** A file of the person's computer for `adb install` / `adb push`: the browser's file picker (a page cannot read a path). */
  const chooseFile = path => new Promise((resolve, reject) => {
    print('hint', `${path}: uma página não lê caminhos do computador. Escolha o arquivo na janela do navegador.`);
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'cp-button adb-pick'; button.textContent = `Escolher ${baseName(path)}…`; output.append(button); output.scrollTop = output.scrollHeight;
    const finish = (file, error) => { picker.removeEventListener('change', chosen); picker.removeEventListener('cancel', cancelled); button.remove(); picker.value = ''; if (file) resolve(file); else reject(Object.assign(new Error(error), { name: 'AdbError', exitCode: 1 })); };
    const chosen = () => finish(picker.files?.[0] ?? null, `adb: ${path}: nenhum arquivo escolhido`), cancelled = () => finish(null, `adb: ${path}: a escolha do arquivo foi cancelada`);
    picker.addEventListener('change', chosen); picker.addEventListener('cancel', cancelled);
    picker.accept = /\.apk$/i.test(path) ? '.apk,application/vnd.android.package-archive' : '';
    button.addEventListener('click', () => picker.click());
    try { picker.click(); } catch { /* no user activation left: the button above opens it */ }
  });
  /** A file the command writes on the computer (`adb pull`, `> file`): a download with that name. */
  const download = async (path, blob) => { const link = doc.createElement('a'); link.href = URL.createObjectURL(blob); link.download = baseName(path); link.hidden = true; doc.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 60000); print('hint', `download: ${link.download} (${blob.size} bytes)`); };
  async function execute(command) {
    const text = String(command ?? '').trim(); if (!text || busy) return null;
    history.add(text); print('command', text);
    if (text === 'clear' || text === 'cls') { clear(); return null; }
    busy = true; form.dataset.busy = 'true'; input.disabled = true; commands++; if (counter) counter.textContent = `${commands} ${commands === 1 ? 'comando' : 'comandos'}`;
    try {
      onCommand(text);
      const result = await run(text, { localFile: chooseFile, writeLocal: download });
      for (const line of resultLines(result)) { if (line.kind === 'image') picture(line.blob); else print(line.kind, line.text); }
      return result;
    } catch (error) { print('error', String(error?.message ?? error)); return null; }
    finally { busy = false; delete form.dataset.busy; input.disabled = false; if (root.open) input.focus(); }
  }
  function clear() { for (const image of output.querySelectorAll('img')) URL.revokeObjectURL(image.src); output.replaceChildren(); }
  form.addEventListener('submit', event => { event.preventDefault(); const text = input.value; input.value = ''; execute(text); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') { event.preventDefault(); input.value = history.previous(input.value); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); input.value = history.next(); }
    else if (event.key === 'l' && event.ctrlKey) { event.preventDefault(); clear(); }
  });
  root.querySelector('.adb-clear')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); clear(); });
  root.addEventListener('toggle', () => { if (root.open) { if (!output.childElementCount) print('hint', 'Terminal do adb: digite um comando do adb (o "adb" inicial é opcional). adb help lista o que há; clear limpa a tela.'); input.focus(); } });
  return { execute, clear, focus: () => input.focus() };
}
