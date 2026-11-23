// The stable surface of the Code browser (docs/CODE-BROWSER.md) for the debugger UI, plugins and MCP tools: open a class or a file at a method / pc / line, reveal a line,
// listen to clicks in the gutter, put markers in the gutter, read the current selection and the line <-> dex pc map of the open class. Lines are 1-based everywhere here;
// pcs are dex code-unit offsets within a method (what the VM's frames and src/smali-disassembler.js use). Page only; no Worker state is read here.

const MARKER_KIND = /^[\w-]{1,32}$/;
/**
 * `browser`: src/code-browser.js createCodeBrowser's result. Returns the API object (window.apkLabCodeBrowser on the page).
 */
export function createCodeBrowserApi(browser) {
  const api = {
    /**
     * Opens a class (descriptor 'Lpkg/Name;' or 'pkg.Name') or an APK entry ('assets/x.txt', 'AndroidManifest.xml'). Options: method ('name(sig)ret', a full key
     * 'Lpkg/Name;->name(sig)ret', or { name, signature }), pc (with method: the line of that instruction), line (1-based), tab ('smali' | 'java' | 'info'; default: the
     * tab the user reads classes in -- the Java tab is decompiled on demand).
     * Resolves the selection after opening.
     */
    async open(target, { method = null, pc = null, line = null, tab = null } = {}) {
      let spec = method;
      if (typeof method === 'string') {
        const body = method.includes('->') ? method.slice(method.indexOf('->') + 2) : method, open = body.indexOf('(');
        spec = open < 0 ? { name: body, signature: null } : { name: body.slice(0, open), signature: body.slice(open) };
        if (method.includes('->') && !target) target = method.slice(0, method.indexOf('->'));
      }
      await browser.open(target, { method: spec, pc: pc === null || pc === undefined ? null : Number(pc), line: line === null || line === undefined ? null : Number(line) - 1, tab });
      return browser.selection();
    },
    /** Scrolls 1-based `line` of the open document into view and selects it. */
    reveal(line) { browser.reveal(Number(line) - 1); return browser.selection(); },
    /** fn({ line, pc, descriptor, path, method: { key, name, signature } | null, tab, shiftKey, altKey }) on a click in the gutter (line numbers / pc column). Returns an unsubscribe function. */
    onGutterClick(fn) { if (typeof fn !== 'function') throw new TypeError('onGutterClick needs a function'); return browser.onGutterClick(fn); },
    /** fn(selection) each time a class or file is opened. Returns an unsubscribe function. */
    onOpen(fn) { if (typeof fn !== 'function') throw new TypeError('onOpen needs a function'); return browser.onOpen(fn); },
    /** Replaces the gutter markers of the open document: [{ line (1-based), kind }] -- kind becomes the class cb-marker-<kind> (breakpoint, current, disabled, ... styled by the caller's CSS or the lab's). */
    setMarkers(markers) {
      if (!Array.isArray(markers)) throw new TypeError('setMarkers needs an array of { line, kind }');
      for (const m of markers) if (!Number.isInteger(m?.line) || m.line < 1 || (m.kind !== undefined && !MARKER_KIND.test(String(m.kind)))) throw new TypeError(`Invalid marker ${JSON.stringify(m)}: { line: integer >= 1, kind: letters, digits, - or _ }`);
      browser.setMarkers(markers);
    },
    /** The selection: { kind: 'class' | 'file', descriptor, path, tab, line, pc, method: { key, name, signature } | null, text, selectedText } or null when nothing is open. */
    currentSelection() { return browser.selection(); },
    /** The open document: { kind, descriptor, path, tab, lineCount, methods: [{ key, name, signature, startLine, endLine, hasCode, modified, pcToLine: [[pc, line]] }] } or null. */
    document() { return browser.document(); },
    /** The 1-based line of instruction `pc` of method `key` in the open class's tab (smali, or the Java line that runs it), or null. */
    lineForPc(key, pc) { return browser.lineForPc(key, pc); },
    /** { key, pc } of the instruction on 1-based `line` of the open class (smali: that instruction; Java: the first instruction of that line), or null for a line that runs no code. */
    pcForLine(line) {
      const doc = browser.document(); if (!doc) return null;
      if (doc.tab === 'java') { const at = browser.locationAt(Number(line)); return at ? { key: at.key, pc: at.pc } : null; }
      for (const m of doc.methods ?? []) { if (line < m.startLine || line > m.endLine) continue; const hit = m.pcToLine.find(([, l]) => l === Number(line)); return hit ? { key: m.key, pc: hit[0] } : null; }
      return null;
    },
    /** { key, pc, line } where a breakpoint on 1-based `line` goes (a smali line without an instruction: the next instruction of its method), or null. */
    locationAt(line) { return browser.locationAt(Number(line)); },
    /** The Java statement of `pc` in method `key` when the Java tab of its class is on screen: { line, pcs, stops } (what a step by Java statement leaves and stops at), else null. */
    javaStatement(key, pc) { return browser.javaStatement(key, pc); },
    /** Prepares the Java view for a debugger session (loads the decompiler in the Worker when the user reads Java). */
    prepareJava() { return browser.prepareJava(); },
    /** The text of 1-based `line` of the open document. */
    lineText(line) { return browser.lineText(Number(line)); },
  };
  return Object.freeze(api);
}
