// The Code tool and the debugger on the page, loaded on first use (docs/CODE-BROWSER.md "Loaded on first use", docs/DEBUGGER.md). The Code browser (src/code-browser.js,
// src/code-browser-api.js, the smali tools), the debugger UI (src/debugger-ui.js), the debugger controller (src/debugger-controller.js) and the plugins' lab.code /
// lab.debug (src/debugger-plugin-actions.js) are fetched with import() only when something needs them:
//   - the Code tab opens (the toggle of its <details>): the browser, its API and the debugger UI (with the controller);
//   - a plugin, MCP or the console calls code.* / debug.* (window.apkLabDebugger, lab.code, lab.debug, code_* / debug_* tools): the controller (and the plugin actions);
//     window.apkLabCodeBrowser.open(): the browser;
//   - an APK opens whose package has saved breakpoints (a tiny check of localStorage): the controller, which sets them again before the app's code runs.
// Until then nothing of it runs: no module, no listener but the tab's toggle, no Worker message, nothing per load or per frame. With the tab closed the browser and the
// debugger UI paint nothing (they catch up when it opens); a debugger session someone attached keeps working: events, breakpoints and pauses, the page's paused chip and
// cover (driven here from the controller's state), and a pause opens the tab when the user's own breakpoint was hit, or flags the tab ("paused") otherwise.
// window.apkLabCodeBrowser and window.apkLabDebugger are the facades below: the same calls (docs), loading on the first one that needs the real thing; before that the read
// calls answer what is true (nothing open, not attached). Saved file edits live in the loaded browser (none can exist before it loaded); method edits are re-applied by the
// "App modified" panel (src/method-hooks-panel.js), which does not depend on this. No process.*.

export const BREAKPOINT_STORE_KEY = 'apkweb.debugger.breakpoints.v1';   // = src/debugger-controller.js DEBUG_STORE_KEY (tests/code-tool-lazy.test.mjs checks it)
/** The page modules this loader keeps out of the page's start (tests/code-tool-lazy.test.mjs). */
export const LAZY_CODE_MODULES = Object.freeze(['code-browser.js', 'code-browser-api.js', 'debugger-ui.js', 'debugger-controller.js', 'debugger-plugin-actions.js', 'smali-tools.js']);
const DEFAULT_IMPORTS = {
  browser: () => import('./code-browser.js?v=2e0bd04dc9d5'),
  api: () => import('./code-browser-api.js?v=2e0bd04dc9d5'),
  ui: () => import('./debugger-ui.js?v=2e0bd04dc9d5'),
  controller: () => import('./debugger-controller.js?v=2e0bd04dc9d5'),
  actions: () => import('./debugger-plugin-actions.js?v=2e0bd04dc9d5'),
};
function defaultStorage() { try { return globalThis.localStorage ?? null; } catch { return null; } }

/** The breakpoints the user saved for `packageName` (as stored), [] when none. Reads one localStorage key; never throws. */
export function savedBreakpoints(storage, packageName) {
  if (!packageName) return [];
  try {
    const raw = storage?.getItem?.(BREAKPOINT_STORE_KEY); if (!raw || !raw.includes(JSON.stringify(String(packageName)))) return [];   // the usual case: no JSON parsed at all
    const list = JSON.parse(raw)?.[packageName]; return Array.isArray(list) ? list.filter(spec => spec && typeof spec === 'object') : [];
  } catch { return []; }
}
/** True when `packageName` has saved breakpoints (the controller then has to load to set them again). */
export const hasSavedBreakpoints = (storage, packageName) => savedBreakpoints(storage, packageName).length > 0;
const shortClass = name => { const text = String(name ?? ''); return text.slice(text.lastIndexOf('.') + 1); };
/** Why a thread stopped, as the page says it. */
export const pauseReasonText = p => p.reason === 'exception' ? `exception ${shortClass(p.exception?.type)}` : p.reason === 'step' ? 'step' : p.reason === 'pause' ? 'paused' : p.reason === 'run-to' ? 'run to cursor' : p.conditionError ? 'condition failed' : 'breakpoint';
/** What the page's "Paused in the debugger" shows for a held stop (the controller's `paused`), or null. */
export function pausedInfo(p) {
  if (!p) return null;
  return { where: `${shortClass(p.location?.className)}.${p.location?.methodName ?? '?'}${p.location?.line ? ` line ${p.location.line}` : ''}`, thread: p.threadName ?? p.thread, mode: p.mode, reason: pauseReasonText(p) };
}
const DETACHED_STATE = () => ({ attached: false, engine: null, channel: false, held: false, paused: null, stops: [], lastSnapshot: null, breakpoints: [], logs: [] });

/**
 * root: the Code tool's <details id="code-browser">. vm: the Worker client. hooks: the "App modified" panel. getInventory(): the loaded APK's inventory (null without one).
 * page: { paused(info | null) } -- the page's paused chip, cover and status (info carries resume()). imports: the module loaders (tests count them).
 */
export function createCodeTool({ root, vm, hooks = null, trace = () => {}, getInventory = () => null, page = null, storage = defaultStorage(), imports = DEFAULT_IMPORTS, win = globalThis.window, doc = globalThis.document } = {}) {
  const getPackage = () => getInventory()?.packageName ?? null;
  const L = { controller: null, controllerLoading: null, browser: null, api: null, ui: null, browserLoading: null, actions: null, actionsLoading: null, loads: [], flagged: null, lastPausedSeq: null, vmToken: 0 };
  const pendingChange = new Set(), pendingEvent = new Set(), pendingGutter = new Set(), pendingOpen = new Set();
  const countNode = root?.querySelector?.('.cb-count') ?? null;
  const setCount = text => { if (countNode && !L.browser) countNode.textContent = text; };

  // ---- loading ---------------------------------------------------------------------------------------------------------------------------------------------------------
  function ensureController() {
    if (L.controller) return Promise.resolve(L.controller);
    L.controllerLoading ??= imports.controller().then(module => {
      L.loads.push('controller');
      const controller = module.createDebuggerController({ vm, hooks, getPackage, trace, storage, onFileEdit: (path, edited) => L.browser?.noteFileEdit?.(path, edited) });
      for (const fn of pendingChange) controller.onChange(fn);
      for (const fn of pendingEvent) controller.onEvent(fn);
      controller.onChange(syncPaused);
      L.controller = controller; return controller;
    }).finally(() => { L.controllerLoading = null; });
    return L.controllerLoading;
  }
  /** The browser, its API and the debugger UI (the Code tab opened, or the API's open()); attached to the running APK. */
  function ensureBrowser() {
    if (L.browser) return Promise.resolve(L.api);
    L.browserLoading ??= (async () => {
      const [browserModule, apiModule, uiModule, controller] = await Promise.all([imports.browser(), imports.api(), imports.ui(), ensureController()]);
      if (L.browser) return L.api;
      L.loads.push('browser');
      const browser = browserModule.createCodeBrowser({ root, vm, hooks, trace, getPackage, debugging: () => !!L.controller?.attached, storage, win, doc });
      const api = apiModule.createCodeBrowserApi(browser);
      for (const fn of pendingGutter) api.onGutterClick(fn);
      for (const fn of pendingOpen) api.onOpen(fn);
      L.browser = browser; L.api = api;
      L.ui = uiModule.createDebuggerUi({ root, api, controller, page: null, trace, getPackage, win, doc });
      const inventory = getInventory();
      if (inventory && vm?.worker) await browser.attach(inventory);
      if (controller.paused) L.ui.refreshPaused?.();
      return api;
    })().finally(() => { L.browserLoading = null; });
    return L.browserLoading;
  }
  function ensureActions() {
    if (L.actions) return Promise.resolve(L.actions);
    L.actionsLoading ??= imports.actions().then(module => { L.loads.push('actions'); L.actions = module.debuggerPluginActions(() => debuggerFacade); return L.actions; }).finally(() => { L.actionsLoading = null; });
    return L.actionsLoading;
  }
  root?.addEventListener?.('toggle', () => {
    if (!root.open) return;
    unflag();
    if (!L.browser) ensureBrowser().catch(error => trace(`Code tool: could not be loaded: ${error?.message ?? error}`));
  });

  // ---- a debugger session with the tab closed: the paused indicators, and the tab opened or flagged --------------------------------------------------------------------
  function syncPaused() {
    const controller = L.controller, p = controller?.paused ?? null, info = pausedInfo(p);
    page?.paused?.(info ? { ...info, resume: () => controller.command('resume', {}).catch(error => trace(`Debugger: resume failed: ${error?.message ?? error}`)) } : null);
    if (!p) { L.lastPausedSeq = null; unflag(); return; }
    if (p.seq === L.lastPausedSeq) return;
    L.lastPausedSeq = p.seq;
    if (root?.open) return;   // the debugger UI shows it (it follows the controller itself)
    const mine = new Set(controller.breakpoints().filter(bp => bp.owner === 'user').map(bp => bp.id));
    if ((p.reasons ?? []).some(reason => mine.has(reason.id))) { root.open = true; return; }   // the user's own breakpoint: the Code tab opens on it (the toggle loads the UI)
    flag();
  }
  function flag() {
    if (!countNode || L.flagged !== null) return;
    L.flagged = countNode.textContent; countNode.textContent = 'paused'; root.classList?.add?.('cb-flagged');
  }
  function unflag() {
    if (L.flagged === null) return;
    if (countNode && countNode.textContent === 'paused') countNode.textContent = L.flagged;
    L.flagged = null; root.classList?.remove?.('cb-flagged');
  }

  // ---- the VM's lifecycle ------------------------------------------------------------------------------------------------------------------------------------------------
  /** A new VM is loaded, before the app's code runs: the loaded browser re-applies its file edits; saved breakpoints are set again (loading the controller only if some exist). */
  async function vmAttached(inventory) {
    unflag(); L.lastPausedSeq = null;
    const classes = inventory?.classCount ?? inventory?.classes ?? null;
    setCount(typeof classes === 'number' ? `${classes} classes` : 'ready');
    if (L.browser) await L.browser.attach(inventory);
    const pkg = inventory?.packageName ?? null;
    if (L.controller || hasSavedBreakpoints(storage, pkg)) {
      const controller = await ensureController();
      await controller.vmAttached(pkg).catch(error => trace(`Debugger: the saved breakpoints were not set again: ${error?.message ?? error}`));
    }
  }
  function vmEnded() { unflag(); L.lastPausedSeq = null; L.browser?.vmEnded(); L.controller?.vmEnded(); setCount('no app'); }
  /** A debugger event from the Worker (only an attached session sends any). */
  function handleDebugEvent(event) { L.controller?.handleEvent(event); }
  /** A plugin stopped: its breakpoints and file edits go (nothing to do when the controller never loaded: it has none). */
  const removeOwner = id => L.controller ? L.controller.removeOwner(id) : Promise.resolve({ removed: 0 });

  // ---- window.apkLabDebugger: the controller's API, loading it on the first call that needs it ---------------------------------------------------------------------------
  const later = name => async (...args) => (await ensureController())[name](...args);
  const debuggerFacade = {
    attach: later('attach'), setBreakpoint: later('setBreakpoint'), removeBreakpoint: later('removeBreakpoint'), enableBreakpoint: later('enableBreakpoint'), updateBreakpoint: later('updateBreakpoint'),
    toggleAt: later('toggleAt'), command: later('command'), waitForPause: later('waitForPause'),
    async detach(options) { return L.controller || options?.forget ? later('detach')(options) : { detached: false }; },   // never attached: nothing to detach (forget still clears the saved ones)
    removeOwner: (id, options) => L.controller ? L.controller.removeOwner(id, options) : Promise.resolve({ removed: 0 }),
    breakpoints: options => L.controller ? L.controller.breakpoints(options) : [],
    breakpointAt: (key, pc) => L.controller ? L.controller.breakpointAt(key, pc) : null,
    state: () => L.controller ? L.controller.state() : { ...DETACHED_STATE(), held: !!vm?.debugHeld },
    storedFor: pkg => L.controller ? L.controller.storedFor(pkg) : savedBreakpoints(storage, pkg),
    handleEvent: event => L.controller?.handleEvent(event),
    vmAttached: pkg => ensureController().then(controller => controller.vmAttached(pkg)),
    vmEnded: () => L.controller?.vmEnded(),
    code: Object.freeze(Object.fromEntries(['search', 'disassemble', 'decompile', 'classInfo', 'readFile', 'files', 'editFile', 'revertFile', 'editMethod'].map(name => [name, async (...args) => (await ensureController()).code[name](...args)]))),
    get attached() { return L.controller?.attached ?? false; },
    get paused() { return L.controller?.paused ?? null; },
    get crossOriginIsolated() { return L.controller?.crossOriginIsolated ?? false; },
    get loaded() { return !!L.controller; },
    onChange(fn) { if (L.controller) return L.controller.onChange(fn); pendingChange.add(fn); return () => { pendingChange.delete(fn); }; },
    onEvent(fn) { if (L.controller) return L.controller.onEvent(fn); pendingEvent.add(fn); return () => { pendingEvent.delete(fn); }; },
    /** Loads the controller now (resolves it). */
    ready: () => ensureController(),
  };

  // ---- window.apkLabCodeBrowser: src/code-browser-api.js, loading the browser on open() ---------------------------------------------------------------------------------
  const browserFacade = {
    async open(target, options) { return (await ensureBrowser()).open(target, options); },
    reveal: line => L.api ? L.api.reveal(line) : null,
    onGutterClick(fn) { if (typeof fn !== 'function') throw new TypeError('onGutterClick needs a function'); if (L.api) return L.api.onGutterClick(fn); pendingGutter.add(fn); return () => { pendingGutter.delete(fn); }; },
    onOpen(fn) { if (typeof fn !== 'function') throw new TypeError('onOpen needs a function'); if (L.api) return L.api.onOpen(fn); pendingOpen.add(fn); return () => { pendingOpen.delete(fn); }; },
    setMarkers(markers) { if (L.api) return L.api.setMarkers(markers); if (!Array.isArray(markers)) throw new TypeError('setMarkers needs an array of { line, kind }'); },   // nothing is open yet: no marker to draw
    currentSelection: () => L.api ? L.api.currentSelection() : null,
    document: () => L.api ? L.api.document() : null,
    lineForPc: (key, pc) => L.api ? L.api.lineForPc(key, pc) : null,
    pcForLine: line => L.api ? L.api.pcForLine(line) : null,
    locationAt: line => L.api ? L.api.locationAt(line) : null,
    javaStatement: (key, pc) => L.api ? L.api.javaStatement(key, pc) : null,
    lineText: line => L.api ? L.api.lineText(line) : null,
    get loaded() { return !!L.api; },
    /** Loads the browser now (resolves the API). */
    ready: () => ensureBrowser(),
  };

  return {
    vmAttached, vmEnded, handleDebugEvent, removeOwner, ensureBrowser, ensureController, ensureActions,
    /** lab.code / lab.debug for the plugin host and MCP (src/debugger-plugin-actions.js), loaded on the first call. */
    actions: Object.freeze({ code: async (caller, args) => (await ensureActions()).code(caller, args), debug: async (caller, args) => (await ensureActions()).debug(caller, args) }),
    browserApi: Object.freeze(browserFacade), debugger: debuggerFacade,
    revertFile: path => L.browser ? L.browser.revertFile(path) : debuggerFacade.code.revertFile(path),
    get browser() { return L.browser; }, get controller() { return L.controller; }, get ui() { return L.ui; },
    get loads() { return [...L.loads]; },
  };
}
