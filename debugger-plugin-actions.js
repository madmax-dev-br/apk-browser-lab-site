// The plugins' lab.code and lab.debug (docs/PLUGINS.md "Code and the debugger"), served by the page's debugger controller (src/debugger-controller.js) as plugin-host actions
// (src/plugin-host.js ACTION_METHODS 'code' and 'debug'): the same reads as the Code browser, the same user-change path for edits (listed as "App modified" with the plugin as
// owner, removed when the plugin stops), and the same debugger session as the Code tool's debugger UI (a plugin's breakpoints carry its name and go when it stops).
// Bounds: a search returns at most PLUGIN_CODE_LIMITS.searchResults results per call; the host paces these calls (one at a time per plugin, the Plugin power gap between two).
// DOM-free; no process.*.

export const PLUGIN_CODE_LIMITS = Object.freeze({ searchResults: 500, textChars: 4 * 1024 * 1024, waitMs: 60000 });
const fail = (code, message) => Object.assign(new Error(message), { code });
const pluginOwner = plugin => plugin?.id === 'mcp' ? { kind: 'mcp', id: 'mcp', name: 'MCP' } : { kind: 'plugin', id: String(plugin?.id ?? ''), name: String(plugin?.name ?? 'plugin') };

/** { code(plugin, args), debug(plugin, args) } for the plugin host's actions. `controller`: the page's debugger controller (or a getter of it). */
export function debuggerPluginActions(controllerOrGetter) {
  const controller = () => { const c = typeof controllerOrGetter === 'function' ? controllerOrGetter() : controllerOrGetter; if (!c) throw fail('unsupported', 'The Code browser and the debugger are not available here.'); return c; };
  return {
    async code(plugin, args = {}) {
      const c = controller(), op = String(args.op ?? ''), owner = pluginOwner(plugin);
      switch (op) {
        case 'search': return c.code.search(String(args.query ?? ''), { kinds: Array.isArray(args.kinds) ? args.kinds.map(String) : undefined, limit: Math.min(PLUGIN_CODE_LIMITS.searchResults, Math.max(1, Number(args.limit) || 100)), framework: args.framework === true, cursor: args.cursor ?? null });
        case 'disassemble': return c.code.disassemble(String(args.descriptor ?? ''), args.method ?? null);
        case 'classInfo': return c.code.classInfo(String(args.descriptor ?? ''));
        case 'decompile': return c.code.decompile(String(args.descriptor ?? ''), args.method ?? null);
        case 'readFile': return c.code.readFile(String(args.path ?? ''));
        case 'files': return c.code.files();
        case 'editFile': {
          if (args.bytes !== undefined && !(args.bytes instanceof Uint8Array)) throw fail('bad-args', 'editFile(path, text | Uint8Array)');
          if (args.bytes === undefined && typeof args.text !== 'string') throw fail('bad-args', 'editFile(path, text | Uint8Array)');
          return c.code.editFile(String(args.path ?? ''), args.bytes ?? args.text, owner);
        }
        case 'revertFile': return c.code.revertFile(String(args.path ?? ''), owner);
        default: throw fail('bad-args', `Unknown lab.code operation: ${op.slice(0, 40)}`);
      }
    },
    async debug(plugin, args = {}) {
      const c = controller(), op = String(args.op ?? ''), owner = pluginOwner(plugin), thread = args.thread === undefined || args.thread === null ? undefined : String(args.thread);
      switch (op) {
        case 'attach': return c.attach({ suspend: args.suspend });
        case 'detach': {   // a plugin's detach takes its own breakpoints away; the session ends only when no one else's are left
          await c.removeOwner(owner.id, { files: false });
          if (!c.breakpoints().length && c.attached) return c.detach();
          return { detached: false, removed: true, note: 'The breakpoints of the user or of others stay: the debugger stays attached for them.' };
        }
        case 'state': return c.state();
        case 'setBreakpoint': return c.setBreakpoint(args.breakpoint ?? {}, owner);
        case 'removeBreakpoint': return c.removeBreakpoint(String(args.id ?? ''), owner);
        case 'enableBreakpoint': return c.enableBreakpoint(String(args.id ?? ''), args.enabled !== false, owner);
        case 'breakpoints': return c.breakpoints({ owner: args.all === true ? null : owner });
        case 'pause': return c.command('pause', { thread });
        case 'resume': return c.command('resume', { thread });
        case 'step': return c.command('step', { thread, kind: ['into', 'over', 'out'].includes(args.kind) ? args.kind : 'over', unit: args.unit === 'instruction' ? 'instruction' : 'line',
          ...(Array.isArray(args.pcs) ? { pcs: args.pcs.slice(0, 65536).map(Number), method: args.method === undefined ? undefined : String(args.method), ...(Array.isArray(args.stops) ? { stops: args.stops.slice(0, 65536).map(Number) } : {}) } : {}) });
        case 'runTo': return c.command('run-to', { thread, ...(args.method ? { method: String(args.method), pc: Number(args.pc) } : { className: String(args.className ?? ''), line: Number(args.line) }) });
        case 'threads': return c.command('threads');
        case 'frames': return c.command('frames', { thread, start: args.start, count: Math.min(256, Math.max(1, Number(args.count) || 64)) });
        case 'locals': return c.command('locals', { thread, frame: Number(args.frame) || 0 });
        case 'evaluate': return c.command('evaluate', { thread, frame: Number(args.frame) || 0, expression: String(args.expression ?? '') });
        case 'setLocal': return c.command('set-local', { thread, frame: Number(args.frame) || 0, name: String(args.name ?? ''), value: args.value });
        case 'inspect': return c.command('inspect', { handle: String(args.handle ?? ''), options: args.options ?? { depth: 1 } });
        case 'wait': { const event = await c.waitForPause(Math.min(PLUGIN_CODE_LIMITS.waitMs, Math.max(0, Number(args.timeoutMs) || 10000)), { current: args.current !== false }); return event; }
        default: throw fail('bad-args', `Unknown lab.debug operation: ${op.slice(0, 40)}`);
      }
    },
  };
}
