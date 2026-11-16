// The command-line side of the adb interpreter (src/adb-commands.js), DOM-free: a line is split as a POSIX shell splits it (quotes, backslashes), into the simple commands of
// a list (`;`, `&&`, `||`) and of a pipeline (`|`), with an output redirection (`> file`, `>> file`). Nothing is expanded: no variables, globs, substitutions or subshells; a line
// that uses one is refused by name instead of being run as something else. The text filters people put after adb in a pipe (grep, head, tail, wc, sort, uniq, cat, tr -d) are
// implemented here over the text of the previous stage. No process.*.

export class AdbError extends Error {
  /** `code`: the exit status the command reports (adb and the device shell use 1; 127 is "not found"; 2 is a usage error). */
  constructor(message, { code = 1, kind = 'error' } = {}) { super(message); this.name = 'AdbError'; this.exitCode = code; this.kind = kind; }
}
/** A command or option this interpreter does not implement: said by name, never run as something else. */
export const unsupported = (what, why = '') => new AdbError(`não implementado no APK Web Lab: ${what}${why ? ` (${why})` : ''}`, { code: 127, kind: 'unsupported' });
export const usage = message => new AdbError(message, { code: 2, kind: 'usage' });

const OPERATORS = ['&&', '||', '>>', '2>&1', '|', ';', '>', '<', '&'];

/**
 * Splits a command line into words and operators: [{ text, quoted }] for words, [{ op }] for operators. Single quotes are literal, double quotes keep everything but \" \\ \$ \`,
 * a backslash outside quotes escapes the next character. `$`, a backquote and an unquoted glob in a position where the shell would expand them are refused.
 */
export function splitLine(line) {
  const out = [], text = String(line ?? ''); let word = null, quoted = false, i = 0;
  const push = () => { if (word !== null) { out.push({ text: word, quoted }); word = null; quoted = false; } };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") { const end = text.indexOf("'", i + 1); if (end < 0) throw usage('aspas simples sem fechar'); word = (word ?? '') + text.slice(i + 1, end); quoted = true; i = end + 1; continue; }
    if (ch === '"') {
      let j = i + 1, part = '';
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && j + 1 < text.length && '"\\$`'.includes(text[j + 1])) { part += text[++j]; continue; }
        if (text[j] === '$' || text[j] === '`') throw unsupported(`expansão do shell (${text[j]}…) em "${text.slice(i + 1, i + 30)}"`, 'variáveis e substituições não são interpretadas; escreva o valor');
        part += text[j];
      }
      if (j >= text.length) throw usage('aspas duplas sem fechar');
      word = (word ?? '') + part; quoted = true; i = j + 1; continue;
    }
    if (ch === '\\') { if (i + 1 < text.length) { word = (word ?? '') + text[i + 1]; quoted = true; } i += 2; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { push(); i++; continue; }
    if (ch === '$' || ch === '`') throw unsupported(`expansão do shell (${ch}…)`, 'variáveis e substituições não são interpretadas; escreva o valor');
    if (ch === '(' || ch === ')') throw unsupported('subshell ( … )');
    const op = OPERATORS.find(candidate => text.startsWith(candidate, i));
    if (op && !(op === '2>&1' && word !== null)) { push(); out.push({ op }); i += op.length; continue; }
    if (ch === '2' && word === null && text.startsWith('2>', i)) { push(); out.push({ op: text.startsWith('2>>', i) ? '2>>' : '2>' }); i += text.startsWith('2>>', i) ? 3 : 2; continue; }
    word = (word ?? '') + ch; i++;
  }
  push(); return out;
}

/**
 * A split line as a list of pipelines: [{ join: null | '&&' | '||' | ';', stages: [argv, ...], redirect: { file, append } | null }]. `2>&1` is accepted (the two streams are
 * one text here); `2> file`, `<` and `&` are refused.
 */
export function parseLine(line) {
  const list = []; let stages = [[]], redirect = null, join = null;
  const tokens = splitLine(line);
  const close = next => {
    if (stages.some(stage => !stage.length)) { if (stages.length === 1 && !redirect && !list.length && next === null) return; throw usage('comando vazio antes ou depois de um operador'); }
    list.push({ join, stages, redirect }); stages = [[]]; redirect = null; join = next;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.op) { if (redirect) throw usage('texto depois do arquivo de saída'); stages.at(-1).push(token.text); continue; }
    if (token.op === '|') { if (redirect) throw usage('| depois de um redirecionamento'); stages.push([]); }
    else if (token.op === '&&' || token.op === '||' || token.op === ';') close(token.op);
    else if (token.op === '>' || token.op === '>>') { const file = tokens[++i]; if (!file || file.op) throw usage(`${token.op} sem o arquivo`); redirect = { file: file.text, append: token.op === '>>' }; }
    else if (token.op === '2>&1') { /* one stream here */ }
    else if (token.op === '2>' || token.op === '2>>') { const file = tokens[++i]; if (file?.text !== '/dev/null') throw unsupported(`${token.op} ${file?.text ?? ''}`.trim(), 'só 2>/dev/null e 2>&1'); }
    else throw unsupported(`operador ${token.op}`);
  }
  close(null);
  return list;
}

const lines = text => { const rows = String(text ?? '').split('\n'); if (rows.at(-1) === '') rows.pop(); return rows; };
const unlines = rows => rows.length ? rows.join('\n') + '\n' : '';
/** Short options of a filter: letters that take no value, and those in `valued` that take one (attached or as the next word). -> { flags: Set, values: Map, rest: [] } */
function options(argv, valued = '') {
  const flags = new Set(), values = new Map(), rest = []; let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { i++; break; }
    if (!/^-[A-Za-z0-9]/.test(arg) || arg === '-') break;
    if (/^-\d+$/.test(arg)) { values.set('n', arg.slice(1)); continue; }   // head -5
    for (let j = 1; j < arg.length; j++) {
      const letter = arg[j];
      if (valued.includes(letter)) { const value = arg.slice(j + 1) || argv[++i]; if (value === undefined) throw usage(`-${letter} pede um valor`); values.set(letter, value); break; }
      flags.add(letter);
    }
  }
  return { flags, values, rest: [...rest, ...argv.slice(i)] };
}

/** The text filters of a pipe: name -> (argv after the name, input text) -> { stdout, code }. A file operand is refused: they filter the previous stage only. */
export const FILTERS = {
  grep(argv, input) {
    const { flags, values, rest } = options(argv, 'emABC'); const known = 'ivcFEwxnoqe';
    for (const flag of flags) if (!known.includes(flag)) throw unsupported(`grep -${flag}`);
    for (const key of values.keys()) if (!'em'.includes(key)) throw unsupported(`grep -${key}`);
    const pattern = values.get('e') ?? rest.shift(); if (pattern === undefined) throw usage('grep: falta o padrão');
    if (rest.length) throw unsupported(`grep em arquivo (${rest[0]})`, 'filtra só a saída do comando anterior');
    let source = flags.has('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : flags.has('E') ? pattern : pattern.replace(/\\([|()+?{}])|([|()+?{}])/g, (match, escaped, bare) => escaped ?? `\\${bare}`);   // basic regex: | ( ) + ? { } are literal unless escaped
    if (flags.has('w')) source = `\\b(?:${source})\\b`; if (flags.has('x')) source = `^(?:${source})$`;
    let regex; try { regex = new RegExp(source, flags.has('i') ? 'i' : ''); } catch (error) { throw usage(`grep: padrão inválido: ${error.message}`); }
    const max = values.has('m') ? Number(values.get('m')) : Infinity, rows = lines(input), out = []; let count = 0;
    for (let index = 0; index < rows.length && count < max; index++) {
      const hit = regex.test(rows[index]); if (hit === flags.has('v')) continue; count++;
      if (flags.has('o') && !flags.has('v')) { for (const match of rows[index].matchAll(new RegExp(source, flags.has('i') ? 'gi' : 'g'))) if (match[0] !== '') out.push(`${flags.has('n') ? `${index + 1}:` : ''}${match[0]}`); }
      else out.push(`${flags.has('n') ? `${index + 1}:` : ''}${rows[index]}`);
    }
    if (flags.has('q')) return { stdout: '', code: count ? 0 : 1 };
    return { stdout: flags.has('c') ? `${count}\n` : unlines(out), code: count ? 0 : 1 };
  },
  head(argv, input) { const { values, flags, rest } = options(argv, 'n'); if (flags.size || rest.length) throw unsupported(`head ${[...flags].map(flag => `-${flag}`).concat(rest).join(' ')}`); const n = Number(values.get('n') ?? 10); if (!Number.isInteger(n) || n < 0) throw usage('head: -n pede um número'); return { stdout: unlines(lines(input).slice(0, n)), code: 0 }; },
  tail(argv, input) {
    const { values, flags, rest } = options(argv, 'n'); if (flags.size || rest.length) throw unsupported(`tail ${[...flags].map(flag => `-${flag}`).concat(rest).join(' ')}`);
    const raw = String(values.get('n') ?? '10'), rows = lines(input); if (!/^\+?\d+$/.test(raw)) throw usage('tail: -n pede um número');
    return { stdout: unlines(raw.startsWith('+') ? rows.slice(Math.max(0, Number(raw) - 1)) : Number(raw) ? rows.slice(-Number(raw)) : []), code: 0 };
  },
  wc(argv, input) {
    const { flags, rest } = options(argv); if (rest.length) throw unsupported(`wc em arquivo (${rest[0]})`); for (const flag of flags) if (!'lwc'.includes(flag)) throw unsupported(`wc -${flag}`);
    const text = String(input ?? ''), counts = { l: (text.match(/\n/g) ?? []).length, w: (text.match(/\S+/g) ?? []).length, c: new TextEncoder().encode(text).length };
    const wanted = flags.size ? ['l', 'w', 'c'].filter(key => flags.has(key)) : ['l', 'w', 'c'];
    return { stdout: `${wanted.map(key => counts[key]).join(' ')}\n`, code: 0 };
  },
  sort(argv, input) {
    const { flags, rest } = options(argv); if (rest.length) throw unsupported(`sort em arquivo (${rest[0]})`); for (const flag of flags) if (!'runf'.includes(flag)) throw unsupported(`sort -${flag}`);
    let rows = lines(input); const key = flags.has('f') ? row => row.toLowerCase() : row => row;
    rows.sort(flags.has('n') ? (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) : (a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    if (flags.has('r')) rows.reverse(); if (flags.has('u')) rows = rows.filter((row, index) => index === 0 || key(row) !== key(rows[index - 1]));
    return { stdout: unlines(rows), code: 0 };
  },
  uniq(argv, input) {
    const { flags, rest } = options(argv); if (rest.length) throw unsupported(`uniq em arquivo (${rest[0]})`); for (const flag of flags) if (!'c'.includes(flag)) throw unsupported(`uniq -${flag}`);
    const groups = []; for (const row of lines(input)) { if (groups.length && groups.at(-1).row === row) groups.at(-1).count++; else groups.push({ row, count: 1 }); }
    return { stdout: unlines(groups.map(group => flags.has('c') ? `${String(group.count).padStart(7)} ${group.row}` : group.row)), code: 0 };
  },
  cat(argv, input) { if (argv.length) throw unsupported(`cat ${argv[0]} depois de um |`, 'só repassa a saída do comando anterior'); return { stdout: String(input ?? ''), code: 0 }; },
  tr(argv, input) { if (argv.length !== 2 || argv[0] !== '-d') throw unsupported(`tr ${argv.join(' ')}`, 'só tr -d <caracteres>'); const drop = new Set(argv[1].replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\t/g, '\t')); return { stdout: [...String(input ?? '')].filter(ch => !drop.has(ch)).join(''), code: 0 }; },
};
FILTERS.egrep = (argv, input) => FILTERS.grep(['-E', ...argv], input);
FILTERS.fgrep = (argv, input) => FILTERS.grep(['-F', ...argv], input);

/**
 * Runs a parsed list: `run(argv, { first })` executes the first stage of each pipeline -> { stdout, code, images?, binary? }; later stages are FILTERS over the text. The list
 * follows the shell's rules (&& after success, || after failure, ; always); the result is the concatenated output and the status of the last pipeline that ran.
 * `filtersOnly(name)`: what to say for a later stage that is not a filter. -> { stdout, code, images, binary, redirect }
 */
export async function runList(list, run, { describeStage = name => `${name} depois de um |`, allowRedirect = false } = {}) {
  let stdout = '', code = 0, images = [], binary = null, redirect = null, ran = false;
  for (const pipeline of list) {
    if (ran && ((pipeline.join === '&&' && code !== 0) || (pipeline.join === '||' && code === 0))) continue;
    if (pipeline.redirect && !allowRedirect) throw unsupported(`redirecionamento para ${pipeline.redirect.file}`);
    for (const stage of pipeline.stages.slice(1)) if (!Object.hasOwn(FILTERS, stage[0])) throw unsupported(describeStage(stage[0]), `os filtros de texto aqui são ${Object.keys(FILTERS).join(', ')}`);
    let result = await run(pipeline.stages[0]); ran = true;
    for (const stage of pipeline.stages.slice(1)) {
      if (result.binary) throw unsupported(`${stage[0]} sobre saída binária`);
      result = { ...FILTERS[stage[0]](stage.slice(1), result.stdout), images: [] };
    }
    code = result.code ?? 0;
    if (pipeline.redirect) { if (list.length > 1) throw unsupported('redirecionamento junto com ; && ou ||', 'um comando por chamada quando a saída vai para um arquivo'); redirect = { ...pipeline.redirect, binary: result.binary ?? null, text: result.binary ? null : result.stdout ?? '' }; continue; }
    if (result.binary) { if (list.length > 1 || stdout) throw unsupported('saída binária junto com outros comandos'); binary = result.binary; }
    stdout += result.stdout ?? ''; if (result.images?.length) images = images.concat(result.images);
  }
  return { stdout, code, images, binary, redirect };
}
