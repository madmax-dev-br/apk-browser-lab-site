// The adb terminal of the tool dock: a command line that only runs adb, drawn as a terminal (one dark screen: what was printed, then the prompt as its last line; Enter runs,
// a click anywhere on the screen puts the caret back on the prompt; while a command runs the prompt gives way to a block cursor). What is typed goes to the page's adb interpreter (src/adb-commands.js: the same one the MCP tool `adb`
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
const baseName = path => String(path ?? '').replace(/^pull:/, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'file';

/**
 * root: the terminal's <details> (index.html #adb-terminal: .adb-screen, the scrolling screen, holding .adb-output and .adb-form with .adb-input; .adb-file, .adb-clear, .adb-count).
 * run(command, io) -> the interpreter's result ({ stdout, stderr, code, images, notes }). Returns { execute(command), clear(), focus() }.
 */
export function createAdbTerminal({ root, run, doc = globalThis.document, history = createCommandHistory(), onCommand = () => {} }) {
  const output = root.querySelector('.adb-output'), form = root.querySelector('.adb-form'), input = root.querySelector('.adb-input'), picker = root.querySelector('.adb-file'), counter = root.querySelector('.adb-count');
  const screen = root.querySelector('.adb-screen') ?? output, toEnd = () => { screen.scrollTop = screen.scrollHeight; };
  let busy = false, commands = 0;
  const print = (kind, text) => { const line = doc.createElement('div'); line.className = `adb-line adb-${kind}`; line.textContent = text; output.append(line); toEnd(); return line; };
  const picture = blob => { const image = doc.createElement('img'); image.className = 'adb-image'; image.alt = 'Image returned by the command'; image.src = URL.createObjectURL(blob); image.addEventListener('load', toEnd); output.append(image); };
  /** A file of the person's computer for `adb install` / `adb push`: the browser's file picker (a page cannot read a path). */
  const chooseFile = path => new Promise((resolve, reject) => {
    print('hint', `${path}: a page cannot read paths on the computer. Choose the file in the browser's window.`);
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'cp-button adb-pick'; button.textContent = `Choose ${baseName(path)}…`; output.append(button); toEnd();
    const finish = (file, error) => { picker.removeEventListener('change', chosen); picker.removeEventListener('cancel', cancelled); button.remove(); picker.value = ''; if (file) resolve(file); else reject(Object.assign(new Error(error), { name: 'AdbError', exitCode: 1 })); };
    const chosen = () => finish(picker.files?.[0] ?? null, `adb: ${path}: no file chosen`), cancelled = () => finish(null, `adb: ${path}: file selection was cancelled`);
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
    busy = true; form.dataset.busy = 'true'; if (screen.dataset) screen.dataset.busy = 'true'; input.disabled = true; commands++; if (counter) counter.textContent = `${commands} ${commands === 1 ? 'command' : 'commands'}`;
    try {
      onCommand(text);
      const result = await run(text, { localFile: chooseFile, writeLocal: download });
      for (const line of resultLines(result)) { if (line.kind === 'image') picture(line.blob); else print(line.kind, line.text); }
      return result;
    } catch (error) { print('error', String(error?.message ?? error)); return null; }
    finally { busy = false; delete form.dataset.busy; if (screen.dataset) delete screen.dataset.busy; input.disabled = false; toEnd(); if (root.open) input.focus(); }
  }
  function clear() { for (const image of output.querySelectorAll('img')) URL.revokeObjectURL(image.src); output.replaceChildren(); }
  form.addEventListener('submit', event => { event.preventDefault(); const text = input.value; input.value = ''; execute(text); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') { event.preventDefault(); input.value = history.previous(input.value); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); input.value = history.next(); }
    else if (event.key === 'l' && event.ctrlKey) { event.preventDefault(); clear(); }
  });
  root.querySelector('.adb-clear')?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); clear(); });
  // as in a terminal, a click on the screen goes to the prompt (not one that ends a text selection, nor one on a button or an image of the output)
  screen.addEventListener?.('click', event => { if (event.target?.closest?.('button, a, img, input')) return; if (String(globalThis.getSelection?.() ?? '')) return; input.focus(); });
  root.addEventListener('toggle', () => { if (root.open) { if (!output.childElementCount) print('hint', 'adb help lists the commands · clear clears the screen · ↑ ↓ history'); input.focus(); } });
  return { execute, clear, focus: () => input.focus() };
}
