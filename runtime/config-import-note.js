// An import of the Controls' configuration that carries plugins (JavaScript the page then runs) is never silent: the page tells the VM Worker, which keeps the note for the trace and the
// Resumo. DOM-free, no process.*. note: { source, plugins: [{ name, chars, replaced }], when (epoch ms) }.
export const MAX_NOTES = 10;

/** Keeps the note on the platform and writes it to the trace. */
export function noteConfigImport(runtime, note) {
  const list = runtime.platform.configImports ??= [];
  const entry = { source: String(note?.source ?? '').slice(0, 120), when: Number(note?.when) || Date.now(), plugins: (Array.isArray(note?.plugins) ? note.plugins : []).slice(0, 32).map(p => ({ name: String(p.name ?? '').slice(0, 120), chars: Number(p.chars) || 0, replaced: !!p.replaced })) };
  list.push(entry); if (list.length > MAX_NOTES) list.shift();
  runtime.record?.(`NET configuration imported from ${entry.source} with ${entry.plugins.length} plugin(s) (JavaScript run by the page): ${entry.plugins.map(p => `${p.name}${p.replaced ? ' (replaced one)' : ''}`).join('; ').slice(0, 300)}`);
  return list.length;
}

/** Lines for the Resumo, or null when no import carried plugins. */
export function configImportSummaryLines(runtime) {
  const list = runtime.platform?.configImports; if (!list?.length) return null;
  const lines = [`Configuration imported with plugins: ${list.length} import${list.length === 1 ? '' : 's'} (the plugins' JavaScript runs in the page, chosen by the user)`];
  for (const entry of list.slice(-5)) lines.push(`  ${entry.source}: ${entry.plugins.map(p => `${p.name} (${p.chars} characters${p.replaced ? ', replaced one' : ''})`).join(', ')}`);
  return lines;
}
