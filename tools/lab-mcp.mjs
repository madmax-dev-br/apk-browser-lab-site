#!/usr/bin/env node
// MCP bridge for APK Web Lab: lets an MCP client (Claude Desktop, Claude Code ...) use the lab page that is open in your browser: screenshots of the screen or of one component,
// the output of the running plugins, the Compose tree and CompositionLocals, ViewModels and static state, Logcat and the network log, "Screen ready".
// A web page cannot accept connections, so this small process sits between them:
//
//   MCP client  --stdio (JSON-RPC, MCP)-->  lab-mcp.mjs  <--HTTP on 127.0.0.1 (events + results)--  the lab page (Controls > MCP: it connects by itself)
//
//   node lab-mcp.mjs serve                the simple way: stays running and serves MCP over HTTP at http://<host>:<port>/mcp (Streamable HTTP, JSON responses), so the client
//                                         only needs that address (claude mcp add --transport http apk-lab http://127.0.0.1:8790/mcp). --host 127.0.0.1 by default; --host
//                                         0.0.0.0 (or a local IP) also accepts MCP clients from other machines of the network: then ANY machine on the network can drive the lab
//                                         (there is no token) and the traffic is plain HTTP, so use it on networks you trust. The page always reaches the bridge on this machine.
//   node lab-mcp.mjs                      run by the MCP client over stdio: { "mcpServers": { "apk-lab": { "command": "node", "args": ["/path/to/lab-mcp.mjs"] } } }
//   options: --port 8790  --origin <lab origin> (repeatable)  --timeout-ms 60000   (--token and APK_WEB_LAB_MCP_TOKEN, from older versions, are ignored)
//
// No pairing token (the owner's decision, 2026-11-20): the page finds the bridge on its default address and connects by itself (src/mcp-link.js). Every tool call is answered by
// the page, with what the page shows at that moment; the bridge stores nothing. The adb tool reads and writes files here: the local files its command line names are offered to the
// page (GET /file/<id>, same origin check, only while that call is in flight, under an id of 128 random bits): read for `adb install <apk>` and `adb push <local> …`, written for
// `adb pull … [local]`, `> file` and the video of record_screen (the page posts the bytes to POST /file/<id>). Only paths written in the MCP client's own command, only for the length
// of the call. Safety: it listens on 127.0.0.1 only by default (other machines cannot reach it); the page's requests must come from one of the allowed origins (the public lab and a
// local copy by default: another site open in the same browser is refused by its Origin), and so must every browser request to /mcp (a page of another site cannot drive it).
// MCP clients that are not browsers send no Origin and are admitted: a program on this machine can use the bridge. An address from an older version (/mcp/<token>, /<token>/events)
// keeps working: the extra segment is ignored. Node.js built-ins only. Protocol logs go to stderr; stdout carries MCP messages only.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8790;
export const DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'apk-web-lab', title: 'APK Web Lab (page open in the browser)', version: '1.4.0' };
const MAX_RESULT_BYTES = 24 * 1024 * 1024;
export const MAX_APK_BYTES = 1024 * 1024 * 1024;   // the lab's own limit for an APK (src/app.js)
const LONG_CALL_MS = 300000;   // reading, loading and starting an app can take minutes for a large APK

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = description => ({ type: 'string', description }), num = description => ({ type: 'number', description }), bool = description => ({ type: 'boolean', description });
/** The tools; the page (src/mcp-tools.js) answers each one by name. */
export const TOOLS = [
  { name: 'lab_status', description: 'What the lab page shows now: loaded APK, Activity, windows, "Screen ready" and the reason it is not ready, running plugins, and the method changes in effect ("App modified": lab.hook changes and Method returns rows, with their call counts).', inputSchema: obj() },
  { name: 'screenshot', description: 'Image of the app screen, or of one component: by the layout_bounds key (element_key), by testTag, by a visible text, or by a rectangle (bounds, window coordinates). Optionally wait for the screen to be ready first.',
    inputSchema: obj({ element_key: str('key of a layout_bounds element'), test_tag: str('testTag of the Compose component'), text: str('visible text of the component (the first that contains it)'),
      bounds: obj({ left: num(''), top: num(''), right: num(''), bottom: num('') }, ['left', 'top', 'right', 'bottom']), max_width: num('maximum width of the image in px (default 1080)'), wait_ready: bool('wait for "Screen ready" first (default false)') }) },
  { name: 'layout_bounds', description: 'The boxes of "Show layout bounds": each component (Compose and Views) with key, name, bounds in the window, texts, testTag, role and actions.', inputSchema: obj({ names: bool('name them by composable (default true)') }) },
  { name: 'compose_tree', description: 'The Compose layout tree: each node with id, handle, parent, name, bounds, modifiers and semantics (texts, testTag, actions).', inputSchema: obj({ max_nodes: num('maximum nodes (default 600)'), locals: { type: 'array', items: { type: 'string' }, description: 'CompositionLocals to attach to each node (name or part of one): node.locals.LocalX is the value at that composable' } }) },
  { name: 'composition_locals', description: 'The CompositionLocals of a Compose component (what LocalX.current is worth there). handle comes from compose_tree.', inputSchema: obj({ handle: str('handle of the node (compose_tree)'), only: { type: 'array', items: { type: 'string' }, description: 'names or parts of names' } }, ['handle']) },
  { name: 'find_composition_local', description: 'Where a CompositionLocal is provided on the screen, grouped by value, with a component that sees each value.', inputSchema: obj({ match: str('name of the Local, part of it, or the value\'s class') }, ['match']) },
  { name: 'view_models', description: 'The ViewModels of the screen (Activity, fragments, navigation destinations) with handle and class.', inputSchema: obj() },
  { name: 'inspect', description: 'The fields of a VM object as JSON (read-only).', inputSchema: obj({ handle: str('handle'), depth: num('depth (default 2)') }, ['handle']) },
  { name: 'field', description: 'A value by path from an object: "state.value.items.0.title" (an array of parts for keys with dots).', inputSchema: obj({ handle: str('handle'), path: { type: ['string', 'array'], items: { type: 'string' } }, depth: num('depth (default 1)') }, ['handle', 'path']) },
  { name: 'statics', description: 'The static fields of a class the app has already initialized (Kotlin object, companion, singleton, injection container).', inputSchema: obj({ class_name: str('class name') }, ['class_name']) },
  { name: 'static_field', description: 'A value by path from a static field.', inputSchema: obj({ class_name: str('class name'), path: { type: ['string', 'array'], items: { type: 'string' } } }, ['class_name', 'path']) },
  { name: 'methods', description: 'The methods of an object (by handle) or of a class, with signature, parameters and return type, read from the DEX (nothing runs). To choose what to call with invoke_method.',
    inputSchema: obj({ handle: str('handle of an object (view_models, instances, field)'), class_name: str('or the name of a class'), match: str('part of the name or /regex/'), parameters: num('only those with this number of parameters'), static: bool('only static (true) or only instance (false)') }) },
  { name: 'invoke_method', description: 'Calls an app method on the VM main thread, as a lab operation (like a click): what it schedules runs and the screen updates. Returns the return value as JSON; a Java exception comes back as an error with its type and message.',
    inputSchema: obj({ handle: str('handle of the object (instance method)'), class_name: str('or the class (static method)'), method: str('method name'), args: { type: 'array', description: 'arguments as JSON, in order; an object goes by handle' }, signature: str('JVM signature when there is an overload, e.g. (ILjava/lang/String;)V') }, ['method']) },
  { name: 'classes', description: 'Classes of the APK whose name contains the text (or match /regex/).', inputSchema: obj({ match: str('part of the name'), initialized: bool('only those already initialized') }, ['match']) },
  { name: 'instances', description: 'The live objects of a class (subclasses included), with handles.', inputSchema: obj({ class_name: str('class name'), limit: num('maximum (default 20)') }, ['class_name']) },
  { name: 'referrers', description: 'Who holds an object: static fields and objects (with the field).', inputSchema: obj({ handle: str('handle') }, ['handle']) },
  { name: 'plugins', description: 'The page\'s plugins and the output of each (texts, tables, JSON and images of the blocks), status and errors. outputs: the blocks written with an id (lab.ui.text/kv/table/json(..., { id })) as one JSON object, id -> value.', inputSchema: obj({ id: str('only this plugin (id or name)'), include_images: bool('include the images of the blocks (default true)') }) },
  { name: 'get_plugin', description: 'One plugin with its code (plugins lists them without it): id, name, on/off, package filter, status, last errors and the code.', inputSchema: obj({ plugin: str('id or name of the plugin') }, ['plugin']) },
  { name: 'save_plugin', description: 'Creates a plugin of the lab page (leave "plugin" out; pass name and code) or edits one (plugin: id or name). The plugin is JavaScript that runs in the page with the lab API (lab.on, lab.screen, lab.ui.text/json/table with { id }, lab.button, lab.invoke ...); docs: the Plugins page of the site. To edit, pass code (replaces all of it) or edits (each old_text must appear exactly once; all or nothing), and/or name, enabled, package_filter. It is stored in the browser like one written in Controls \u203a Plugins and starts at once when on; the answer has its status and its errors. Use plugins / click_plugin_button to read its output.',
    inputSchema: obj({ plugin: str('id or name of the plugin to edit; leave out to create'), name: str('name (required to create)'), code: str('the whole code (required to create)'),
      edits: { type: 'array', description: 'changes to parts of the code of an existing plugin, applied in order', items: obj({ old_text: str('text in the current code, found exactly once'), new_text: str('what replaces it') }, ['old_text', 'new_text']) },
      enabled: bool('on (default for a new plugin) or off'), package_filter: str('package ids it runs for, separated by commas, * as a wildcard; empty = every app'), wait_ms: num('wait for the plugin to start up to (default 2000)') }) },
  { name: 'click_plugin_button', description: 'Clicks a plugin button (lab.button), like the user: the plugin\'s code runs and the response comes when it finishes (ok, time, new errors), with outputs (the plugin\'s blocks that have an id, as JSON: id -> value) and written (the ids this click wrote). plugins lists each plugin\'s buttons.',
    inputSchema: obj({ plugin: str('id or name of the plugin'), button: str('id of the button (or its text)'), wait_ms: num('wait for the code to finish up to (default 10000)') }, ['plugin', 'button']) },
  { name: 'logcat', description: 'Logcat lines of the app (collected while MCP is connected). To follow: pass since = the "next" of the previous response (only new lines) and wait_ms to wait until they arrive.',
    inputSchema: obj({ level: str('minimum level: V, D, I, W or E'), contains: str('text in the tag or the message'), limit: num('maximum lines, the most recent (default 200)'), since: num('only what came after this cursor (the "next" of the previous response)'), start: str('"now": returns nothing, only the cursor to follow from now on'), from_time: str('from this moment (ISO 8601 or milliseconds), device clock'), last_seconds: num('only the last N seconds'), wait_ms: num('wait up to N ms for something new (max 30000)') }) },
  { name: 'network', description: 'The app\'s network log: method, URL, status, time, mock or redirect; with include_body, the response body (text). To follow: since and wait_ms, as in logcat.',
    inputSchema: obj({ contains: str('text in the URL or the method'), limit: num('maximum, the most recent (default 50)'), since: num('only what came after this cursor (the "next" of the previous response)'), start: str('"now": returns nothing, only the cursor to follow from now on'), from_time: str('from this moment (ISO 8601 or milliseconds), device clock'), last_seconds: num('only the last N seconds'), wait_ms: num('wait up to N ms for something new (max 30000)'), include_body: bool('include the response body (text, up to 20 KB) and the headers') }) },
  { name: 'set_mock', description: 'Creates or replaces (same id) an endpoint mock: the app\'s requests that match method and URL get this response without going to the network. It lives in Controls › Network › Endpoint mocks of the open package. Afterwards, use reload so the app fetches again.',
    inputSchema: obj({ url: str('URL or pattern (https://api.example.com/v1/profile, *.example.com/v1/*)'), method: str('GET, POST, ... or ANY (default)'), status: num('HTTP status (default 200)'), body: { description: 'response body: text, or an object (becomes JSON)' }, headers: { type: 'object', description: 'response headers, { "Content-Type": "application/json" }' }, delay_ms: num('response delay'), id: str('id to replace the same mock later'), name: str('name shown in the list'), query: str('"ignore" (default) or "exact"') }, ['url']) },
  { name: 'remove_mock', description: 'Removes a mock by id (from set_mock or list_mocks).', inputSchema: obj({ id: str('id of the mock') }, ['id']) },
  { name: 'list_mocks', description: 'The mocks of the open package, with how many times each one answered.', inputSchema: obj() },
  { name: 'tap', description: 'Taps a component (testTag, text or layout_bounds key) or a point (x, y of the window): in Compose it is a real touch, on a View it is the click. Waits for the screen to settle and returns the screen (and the screenshot, if asked).',
    inputSchema: obj({ test_tag: str('testTag of the component'), text: str('visible text of the component (the first that contains it)'), element_key: str('layout_bounds key'), x: num('x in the window'), y: num('y in the window'), wait_ms: num('wait for the screen to settle afterwards (default 2000)'), screenshot: bool('return the screenshot afterwards') }) },
  { name: 'type', description: 'Types into a text field (replaces the whole text): in Compose, focuses the field, selects all and types character by character through the InputConnection, like the Android keyboard (the app\'s masks and filters act as on the device; without an InputConnection, SetText, and the result says so); on a View, the field.',
    inputSchema: obj({ value: str('the text'), test_tag: str('testTag of the component'), text: str('visible text of the component (the first that contains it)'), element_key: str('layout_bounds key'), wait_ms: num('wait for the screen to settle afterwards (default 2000)'), screenshot: bool('return the screenshot afterwards') }, ['value']) },
  { name: 'scroll', description: 'Scrolls the list that contains the component (or the largest list on the screen, with no target): positive dy scrolls down, positive dx goes to the right.',
    inputSchema: obj({ dy: num('how much to scroll vertically, in px (default 400)'), dx: num('horizontally'), test_tag: str('testTag of the component'), text: str('visible text of the component (the first that contains it)'), element_key: str('layout_bounds key'), x: num('x of a point inside the list'), y: num('y'), wait_ms: num('wait for the screen to settle afterwards (default 2000)'), screenshot: bool('return the screenshot afterwards') }) },
  { name: 'scroll_to', description: 'Scrolls a list (or another scrollable component) to a position in px (1 px = 1 dp in the lab) or to a percentage (0 to 100) of the scroll range, vertically and/or horizontally, through the app\'s own scrolling (Compose ScrollBy, View.scrollBy), repeating until it gets there. With no target, the largest list on the screen. Returns the position, the range (maxX/maxY) and the percentage where it stopped; in a lazy list the numbers are the list\'s own estimate (estimated: true).',
    inputSchema: obj({ to_y: num('vertical position in px, from the start'), to_x: num('horizontal position in px'), percent_y: num('vertical percentage of the range, 0 to 100'), percent_x: num('horizontal percentage, 0 to 100'), test_tag: str('testTag of the scrollable component or of something inside it'), text: str('visible text of the component (the first that contains it)'), element_key: str('layout_bounds key'), x: num('x of a point inside the list'), y: num('y'), wait_ms: num('wait for the screen to settle afterwards (default 2000)'), screenshot: bool('return the screenshot afterwards') }) },
  { name: 'scroll_info', description: 'Where a list (or another scrollable component) is, without moving it: x/y position and maxX/maxY range in px, and the percentage. Same target as scroll_to.',
    inputSchema: obj({ test_tag: str('testTag of the scrollable component or of something inside it'), text: str('visible text of the component'), element_key: str('layout_bounds key'), x: num('x of a point inside the list'), y: num('y') }) },
  { name: 'reload', description: 'Reloads the current screen: recreate (default, keeps saved state and ViewModels) or reopen (a new instance with the same Intent).', inputSchema: obj({ mode: str('"recreate" or "reopen"') }) },
  { name: 'wait_ready', description: 'Waits for "Screen ready" (Activity and fragments loaded, nothing pending for 300 ms) and returns the screen. A slow or hanging network request does not hold the wait to the end: with the screen already drawn and still and only the network in flight, the wait gives network_ms more and returns ready: false with networkPending (method, URL and how many seconds each request has been open).', inputSchema: obj({ timeout_ms: num('maximum time (default 15000)'), network_ms: num('with the screen still and only the network in flight, how much longer to wait for it (default 5000; 0 does not wait)') }) },
  { name: 'record_screen', description: 'Records the app screen as video. action "start" begins recording; while it records, use the other tools (tap, type, scroll, adb …); action "stop" ends it and writes the file at path, on the machine where the bridge runs (without path: screen-recording-<date and time>.mp4 or .webm in the bridge\'s folder); "status" says whether it is recording; "discard" throws away a video that has already ended. The recording stops by itself at max_seconds and the video is kept on the page until stop. The format is mp4 when the browser records mp4, otherwise webm (format chooses); the path must end in the format\'s extension, which start returns. It records what a screenshot shows (Compose and Views with a raster); a screen made only of Views drawn by the page\'s DOM has no image and start says so. Keep the lab tab visible: in the background the browser reduces the frames.',
    inputSchema: obj({ action: str('start | stop | status | discard'), path: str('stop: video file to write on the bridge\'s machine (.mp4 or .webm), or a folder'), fps: num('start: frames per second, 1 to 30 (default 12)'), max_width: num('start: maximum video width in px (default 1080; the screen is 1 px per dp)'), max_seconds: num('start: maximum duration, 1 to 300 s (default 60)'), format: str('start: "mp4" or "webm" (default: mp4 if the browser records it, otherwise webm)') }, ['action']) },
  // the Controls panel
  { name: 'app_data', description: 'App data (Controls › Files and data › App data): with no arguments, each SharedPreferences with its keys (type and value) and each SQLite database with tables, columns and row count. prefs: one SharedPreferences file. db + table: a page of rows (rowid first; offset, limit up to 500).', inputSchema: obj({ prefs: str('name of the SharedPreferences file (without .xml)'), db: str('name of the database in databases/'), table: str('table or view'), offset: num('first row (0)'), limit: num('rows (100, up to 500)') }) },
  { name: 'set_preferences', description: 'Changes SharedPreferences through the app\'s own Editor (putX or remove, then commit()): the app sees it on the next read and its listeners are notified. changes: [{ key, type: string|int|long|float|boolean|set, value }] or [{ key, remove: true }]; set is a list of strings.', inputSchema: obj({ name: str('SharedPreferences file (without .xml); may be new'), changes: { type: 'array', items: { type: 'object' }, description: 'the changes, in order' } }, ['name', 'changes']) },
  { name: 'edit_row', description: 'Changes a row of an app SQLite table through a second connection to the database: set (new columns) or remove on a row given by rowid (or key = primary key of a WITHOUT ROWID table), or insert (a new row). Values go as parameters, never pasted into the SQL.', inputSchema: obj({ db: str('database'), table: str('table'), rowid: num('rowid of the row'), key: { type: 'object', description: 'primary key { column: value } (table without rowid)' }, set: { type: 'object', description: '{ column: value }' }, insert: { type: 'object', description: '{ column: value } of the new row' }, remove: bool('deletes the row') }, ['db', 'table']) },
  { name: 'sql', description: 'An SQL command on an app database (second connection, like adb\'s sqlite3): a query returns columns and rows (up to limit), a change returns how many rows changed. params: the values of the ?.', inputSchema: obj({ db: str('database'), sql: str('an SQL command'), params: { type: 'array', description: 'values of the ?' }, limit: num('rows (200, up to 500)') }, ['db', 'sql']) },
  { name: 'device', description: 'The device settings (Controls › Device, Network, Execution, Debugging › Developer options): without set, the current ones and the options; set changes and applies right away, like the panel (connectivity online|metered|offline turns the internet off; language (en, pt, es …) and region (any ISO country, e.g. BR, PT, US) form the locale, or locale directly like pt-BR; darkTheme; orientation portrait|landscape; fontScale; animatorScale; hour24; timeZone; battery { level, charging }; screen; navigation gesture|buttons; renderer gpu|cpu and engine wasm|js take effect on the next launch).', inputSchema: obj({ set: { type: 'object', description: 'settings to change' } }) },
  { name: 'adb', description: 'Runs an adb command line against the lab device (the open page), to reuse the commands of an emulator: adb install app.apk, adb shell am start -n package/.Main, adb shell input tap 200 400, adb shell input text hello, adb logcat -d *:E, adb exec-out screencap -p > screen.png, adb shell uiautomator dump /dev/tty, adb shell pm grant package android.permission.CAMERA, adb shell settings put global animator_duration_scale 0, adb shell dumpsys window | grep mCurrentFocus. It is also how to manage apps and the device: adb install app.apk (an .apk on this machine; the app goes to the home screen), adb shell pm list packages, adb shell pm uninstall package, adb shell monkey -p package 1 or am start -n package/.Main (open; then wait_ready), adb shell am force-stop package (close), adb shell am start -a android.intent.action.VIEW -d <link> (a deep link, to the app whose filters answer it), adb shell input keyevent 4 (Back), adb shell pm grant|revoke package android.permission.X and adb shell dumpsys package package (runtime permissions). Accepts quotes, | grep/head/tail/wc/sort/uniq, && || ; and > file (written on the bridge\'s machine). Each command uses the page\'s own path (install as a dropped file, the icon, Intents resolved by the manifest, real touch, keyboard, Controls settings). It is not adb: what the page cannot reach (am broadcast, services, keys outside a text field, the app\'s private files, forward/reverse) fails with the command\'s name and status 127, and never runs as something else. "adb help" lists everything. Returns the command\'s output, the image (screencap) and, when there is one, the status and lab notes on how the command was served. 1 px = 1 dp (160 dpi).',
    inputSchema: obj({ command: str('the command line, as in a terminal, e.g. "adb shell input tap 200 400" (the leading "adb" is optional)'), args: { type: 'array', items: { type: 'string' }, description: 'or the words of a single adb command, already split, e.g. ["shell", "input", "text", "hello world"]' } }) },
  { name: 'host_redirects', description: 'The Redirect hosts rules (the app asks for one host, the lab serves it from another, e.g. a local server): without rules, the current ones; rules replaces all of them: [{ from: "api.example.com", to: "localhost:8080", enabled: true }].', inputSchema: obj({ rules: { type: 'array', items: { type: 'object' }, description: 'the new rules (replaces all)' } }) },
  // the app's code (the Code tool) and the Java debugger (docs/DEBUGGER.md). Debugging flow: debug_set_breakpoint -> trigger the code (tap, invoke_method, adb am start) -> debug_wait -> inspect (debug_locals, debug_evaluate, debug_stack) -> debug_step or debug_continue -> debug_wait again.
  { name: 'code_search', description: 'Searches the running APK: classes, methods and fields by name, string constants in the code, and APK files. Returns kinds with descriptors and method keys for code_disassemble and debug_set_breakpoint.',
    inputSchema: obj({ query: str('text to find (part of a name, a signature or a string)'), kinds: { type: 'array', items: { type: 'string', enum: ['class', 'method', 'field', 'string', 'file'] }, description: 'only these kinds (default all)' }, limit: num('maximum results (default 50, at most 500)'), framework: bool('also the AOSP framework classes the lab runs from DEX (default false)') }, ['query']) },
  { name: 'code_disassemble', description: 'A class as exact smali (baksmali syntax, with .line directives = source lines), or one method with each instruction prefixed by its dex pc (hex): the pc debug_set_breakpoint and debug_run_to take.',
    inputSchema: obj({ class_name: str('pkg.Name or Lpkg/Name;'), method: str('one method: "name(params)ret" (as the methods list shows), or the name alone') }, ['class_name']) },
  { name: 'code_class_info', description: 'A class\'s superclass, interfaces, flags, source file, annotations, fields (with constant values) and methods (with sizes, and whether one is modified).', inputSchema: obj({ class_name: str('pkg.Name or Lpkg/Name;') }, ['class_name']) },
  { name: 'code_read_file', description: 'An APK entry as text: assets and raw files as they are, compiled XML (manifest, layouts) decoded, resources.arsc summarized, DEX listed, binary as hex. Says whether it can be edited.', inputSchema: obj({ path: str('APK entry path, e.g. assets/config.json or AndroidManifest.xml') }, ['path']) },
  { name: 'code_edit_file', description: 'Replaces the text of an editable APK entry (assets/, res/raw/ and other non-compiled files): the app reads the new bytes the next time it opens it. A change chosen by the user: listed as "App modified" (owner MCP), traced, removable with code_revert_file.', inputSchema: obj({ path: str('APK entry path'), text: str('the new content (UTF-8)') }, ['path', 'text']) },
  { name: 'code_revert_file', description: 'Restores an edited APK entry to the APK\'s bytes.', inputSchema: obj({ path: str('APK entry path') }, ['path']) },
  { name: 'code_edit_method', description: 'Replaces the body of one app method with smali you write (as code_disassemble prints it; .registers or .locals first): verified before it is installed, in effect from the next call, listed as "App modified" (owner MCP) and removable there. Errors list line and message.',
    inputSchema: obj({ class_name: str('pkg.Name or Lpkg/Name;'), method: str('"name(params)ret"'), smali: str('the body: .registers N, the instructions, labels, .catch...'), persist: bool('installed again when the APK is reopened (default false)') }, ['class_name', 'method', 'smali']) },
  { name: 'debug_attach', description: 'Attaches the Java debugger to the running VM (debug_set_breakpoint attaches by itself). Says the engine and whether the page is cross-origin isolated (without it, stops inside input events or lifecycle callbacks are snapshots: no stepping from them). The app never sees the debugger (Debug.isDebuggerConnected stays false).', inputSchema: obj({ suspend: str('all (default: every thread stops with the one that hit) or thread') }) },
  { name: 'debug_detach', description: 'Detaches: every breakpoint leaves the VM and every thread resumes.', inputSchema: obj() },
  { name: 'debug_set_breakpoint', description: 'Sets a breakpoint: class_name + line (a source line, as the .line directives of code_disassemble show), class_name + method + pc (a dex pc), type entry/exit + method, exception (a class or "*", caught/uncaught), or class_name + field (watchpoint). Options: condition (a Java-like expression of the locals), hit_condition ("5", ">= 5", "% 5"), log_message ("i={i}": a logpoint, it never stops). Pending until the class loads. Then trigger the code and call debug_wait.',
    inputSchema: obj({ class_name: str('pkg.Name'), line: num('source line'), method: str('"name(params)ret" or the name'), pc: { type: ['number', 'string'], description: 'dex pc (decimal or "0x1a")' }, type: str('entry | exit | exception (default from the other fields)'), exception: str('exception class (subclasses match), or "*" for any'), caught: bool('stop on caught exceptions (default true)'), uncaught: bool('stop on uncaught exceptions (default true)'), field: str('a field of class_name (watchpoint)'), access: str('read | write | any'), condition: str('stop only when true, e.g. "i > 3 && name != null"'), hit_condition: str('"5", ">= 5", "> 5", "== 5", "% 5"'), log_message: str('logpoint: a message with {expressions}; never stops'), suspend: str('all (default) or thread'), thread: str('only this thread id') }) },
  { name: 'debug_remove_breakpoint', description: 'Removes a breakpoint by id.', inputSchema: obj({ id: str('breakpoint id (debug_breakpoints)') }, ['id']) },
  { name: 'debug_breakpoints', description: 'Every breakpoint (the user\'s, plugins\' and MCP\'s): id, where, enabled, resolved, hits, condition, owner.', inputSchema: obj() },
  { name: 'debug_pause', description: 'Pauses every thread between two VM events (an event that is running finishes first: a breakpoint is the way to stop inside one).', inputSchema: obj() },
  { name: 'debug_continue', description: 'Resumes the paused threads (or one thread). Then debug_wait for the next stop.', inputSchema: obj({ thread: str('only this thread (the others stay paused)') }) },
  { name: 'debug_step', description: 'Steps the paused thread and waits for it to stop again: over (the next line in this method), into (into a call), out (back to the caller); by line (default) or instruction. Returns the new location, stack and locals.',
    inputSchema: obj({ kind: str('over (default) | into | out'), unit: str('line (default) | instruction'), thread: str('thread id (default: the paused one)'), timeout_ms: num('wait for the stop (default 5000)'), wait: bool('false: return at once') }) },
  { name: 'debug_run_to', description: 'Runs the paused thread to a location (class_name + line, or class_name + method + pc) and waits for it there, as a one-shot breakpoint.',
    inputSchema: obj({ class_name: str('pkg.Name'), line: num('source line'), method: str('"name(params)ret"'), pc: { type: ['number', 'string'], description: 'dex pc' }, thread: str('thread id'), timeout_ms: num('wait (default 10000)'), wait: bool('false: return at once') }) },
  { name: 'debug_threads', description: 'The VM\'s threads: id, name, state, held, and where a stopped one is.', inputSchema: obj() },
  { name: 'debug_stack', description: 'The call stack of a paused thread: method, source line and pc of each frame (host code frames marked).', inputSchema: obj({ thread: str('thread id (default: the paused one)'), count: num('frames (default 32)') }) },
  { name: 'debug_locals', description: 'The locals and parameters of a frame of a paused thread, by their debug-info names, with types; objects as { $type, $handle } (expand with inspect).', inputSchema: obj({ thread: str('thread id'), frame: num('0 = innermost (default)'), registers: bool('also the raw registers') }) },
  { name: 'debug_evaluate', description: 'Evaluates a read-only Java-like expression in a frame: locals, this, fields (a.b), arrays (a[i], a.length), static fields (pkg.Class.FIELD), arithmetic, comparisons, && || ?:. No method calls (use invoke_method).', inputSchema: obj({ expression: str('e.g. "sum + i * 10"'), thread: str('thread id'), frame: num('frame (default 0)') }, ['expression']) },
  { name: 'debug_set_local', description: 'Changes a local, a parameter or a register (v3, p0) of a paused frame: a primitive, a string or null. The thread goes on with it.', inputSchema: obj({ name: str('local name, or v3 / p0'), value: { description: 'the new value (JSON)' }, thread: str('thread id'), frame: num('frame (default 0)') }, ['name', 'value']) },
  { name: 'debug_wait', description: 'The main loop of debugging: waits up to timeout_ms for the next stop (returns the current one at once if a thread is already paused) and returns where it stopped (class, method, line, pc), why (breakpoint ids, step, exception with type and message), the stack and the innermost frame\'s locals. timedOut: true when nothing stopped. Use after setting a breakpoint and triggering the code, and after debug_continue.',
    inputSchema: obj({ timeout_ms: num('maximum wait (default 10000, at most 120000)'), include_locals: bool('the locals of frame 0 (default true)'), stack_depth: num('frames (default 16)'), current: bool('return a stop already in place (default true); false waits for a new one'), after: num('only a stop newer than this seq (from a previous answer)') }) },
];

/** The environment variable older page setups passed the pairing token in: ignored now (said once on stderr). */
export const LEGACY_TOKEN_ENV = 'APK_WEB_LAB_MCP_TOKEN';
const PAGE_ACTIONS = new Set(['events', 'result', 'file', 'hello']);
/**
 * The page side of a path: { action, id } for /events, /result, /hello and /file/<id>; an older page put its token first (/<token>/events, /<token>/file/<id>), which is
 * ignored. null for anything else.
 */
export function pageRoute(pathname) {
  const parts = String(pathname ?? '').split('/').slice(1);
  const at = PAGE_ACTIONS.has(parts[0]) ? 0 : PAGE_ACTIONS.has(parts[1]) && /^[A-Za-z0-9_%-]{1,512}$/.test(parts[0] ?? '') ? 1 : -1; if (at < 0) return null;
  const action = parts[at], rest = parts.slice(at + 1);
  if (action === 'file') return rest.length === 1 && rest[0] ? { action, id: rest[0] } : null;
  return rest.length === 0 || (rest.length === 1 && rest[0] === '') ? { action, id: null } : null;
}

/** The words of a command line as a shell splits them (quotes, backslashes), with | ; && || > >> as { op } entries; null when a quote is left open. Kept equal to splitLine of
 *  src/adb-shell.js for what matters here: where each word begins and ends. */
export function shellWords(line) {
  const out = [], text = String(line ?? ''); let word = null;
  const push = () => { if (word !== null) { out.push(word); word = null; } };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") { const end = text.indexOf("'", i + 1); if (end < 0) return null; word = (word ?? '') + text.slice(i + 1, end); i = end; continue; }
    if (ch === '"') { let j = i + 1, part = ''; for (; j < text.length && text[j] !== '"'; j++) { if (text[j] === '\\' && '"\\$`'.includes(text[j + 1] ?? '\n')) j++; part += text[j]; } if (j >= text.length) return null; word = (word ?? '') + part; i = j; continue; }
    if (ch === '\\') { word = (word ?? '') + (text[i + 1] ?? ''); i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { push(); continue; }
    if (word === null && text.startsWith('2>&1', i)) { i += 3; continue; }
    if (word === null && text.startsWith('2>', i)) { out.push({ op: '2>' }); i += text.startsWith('2>>', i) ? 2 : 1; continue; }
    const op = ['&&', '||', '>>', '|', ';', '>'].find(candidate => text.startsWith(candidate, i));
    if (op) { push(); out.push({ op }); i += op.length - 1; continue; }
    word = (word ?? '') + ch;
  }
  push(); return out;
}
/**
 * The local files an adb call names, by the keys the page's interpreter asks for them (src/adb-commands.js): `reads` for `adb install <apk>` and `adb push <local> <remote>`;
 * `writes` for `adb pull <remote> [local]` (key: the local operand, or "pull:<remote>" when it is left out and the file goes to the current folder under its own name) and for
 * `> file` / `>> file`. Nothing else in a command line is ever read or written here.
 */
export function adbLocalFiles({ command = null, args = null } = {}) {
  const reads = [], writes = [], words = Array.isArray(args) && args.length ? args.map(String) : shellWords(command ?? ''); if (!words) return { reads, writes };
  const valued = { '-s': 1, '-H': 1, '-P': 1, '-L': 1, '-t': 1, '--one-device': 1 }, flags = ['-d', '-e', '-a', '--exit-on-write-error'];
  const simple = command => {
    let at = command[0] === 'adb' ? 1 : 0; while (at < command.length && (flags.includes(command[at]) || command[at] in valued)) at += 1 + (valued[command[at]] ?? 0);
    while (/^wait-for-/.test(command[at] ?? '')) at++;
    const sub = command[at], takesValue = sub === 'install' ? ['--user', '--abi'] : ['-z'], operands = [];
    for (let i = at + 1; i < command.length; i++) { if (takesValue.includes(command[i])) { i++; continue; } if (!command[i].startsWith('-')) operands.push(command[i]); }
    if (sub === 'install' && operands.length) reads.push(operands.at(-1));
    else if (sub === 'push' && operands.length) reads.push(operands[0]);
    else if (sub === 'pull' && operands.length) writes.push(operands[1] !== undefined ? { key: operands[1], path: operands[1], remote: operands[0] } : { key: `pull:${operands[0]}`, path: path.basename(operands[0].replace(/\/+$/, '')) || 'pulled-file', remote: null });
  };
  let current = [], first = true;
  for (let i = 0; i <= words.length; i++) {
    const word = words[i];
    if (word === undefined || (typeof word === 'object' && ['|', ';', '&&', '||'].includes(word.op))) { if (first && current.length) simple(current); current = []; first = word === undefined || word.op !== '|'; continue; }
    if (typeof word === 'object') { const file = words[++i]; if (typeof file === 'string' && word.op !== '2>') writes.push({ key: file, path: file, append: word.op === '>>', remote: null }); continue; }
    current.push(word);
  }
  return { reads: [...new Set(reads)], writes };
}

/** The bridge: an HTTP side for the page and an MCP side (handle(message) -> response or null). */
export function createBridge({ port = DEFAULT_PORT, host = '127.0.0.1', origins = DEFAULT_ORIGINS, timeoutMs = 60000, log = message => process.stderr.write(`[lab-mcp] ${message}\n`) } = {}) {   // a `token` option, from older versions, is ignored
  const allowed = new Set(origins), pending = new Map(), files = new Map(), uploads = new Map(); let page = null, nextId = 1, server = null, refused = null, refusedLogged = 0;
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const send = (res, status, body, origin) => { if (origin) cors(origin, res); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  /** MCP over HTTP (Streamable HTTP, JSON responses only): POST /mcp with one JSON-RPC message or a batch (/mcp/<anything>, an older address with a token, is the same). A
   *  browser page of another site is refused by its Origin; clients that are not browsers send none and are admitted (no token since 2026-11-20). */
  function onMcp(req, res, url, origin) {
    const plain = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body === null ? '' : JSON.stringify(body)); };
    if (origin && !allowed.has(origin)) { plain(403, { error: `origin not allowed: ${origin}` }); return; }
    if (origin) cors(origin, res);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type, authorization, mcp-protocol-version' }); res.end(); return; }
    // never 401: to an MCP client a 401 means "log in with OAuth" (MCP authorization), and clients such as Cursor then start an OAuth flow this bridge does not have
    if (req.method !== 'POST') { plain(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method Not Allowed: this bridge answers POST (no server-initiated stream)' } }, { allow: 'POST' }); return; }
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { req.destroy(); return; } chunks.push(chunk); });
    req.on('end', async () => {
      let message; try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { plain(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
      const one = async item => { try { return await handle(item); } catch (error) { return { jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } }; } };
      if (Array.isArray(message)) { const answers = (await Promise.all(message.map(one))).filter(Boolean); if (answers.length) plain(200, answers); else plain(202, null); return; }
      const answer = await one(message); if (answer) plain(200, answer); else plain(202, null);   // a notification or a response from the client: accepted, nothing to say
    });
  }
  function onRequest(req, res) {
    const origin = req.headers.origin ?? null, url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) { onMcp(req, res, url, origin); return; }
    // OAuth discovery (RFC 9728 protected-resource and RFC 8414 server metadata, which MCP clients look up): none here, said plainly, so a client goes on without OAuth
    if (url.pathname.startsWith('/.well-known/')) { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: 'this bridge does not use OAuth: connect to http://127.0.0.1:<port>/mcp' })); return; }
    if (!origin || !allowed.has(origin)) {
      if (origin) { refused = { at: Date.now(), origin }; if (Date.now() - refusedLogged > 5000) { refusedLogged = Date.now(); log(`page refused: its origin (${origin}) is not one of the lab's; run with --origin ${origin} to allow it`); } }
      send(res, 403, { error: `origin not allowed: ${origin ?? '(none)'}; run with --origin ${origin ?? '<lab origin>'}` }); return;
    }
    if (req.method === 'OPTIONS') {
      cors(origin, res, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.writeHead(204); res.end(); return;
    }
    const route = pageRoute(url.pathname), action = route?.action ?? null;
    if (req.method === 'GET' && action === 'events') {
      cors(origin, res); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      if (page) { page.res.write('event: replaced\ndata: {}\n\n'); page.res.end(); }
      const current = { res, origin, since: Date.now() }; page = current;
      res.write(`event: hello\ndata: ${JSON.stringify({ server: SERVER_INFO, tools: TOOLS.map(tool => tool.name) })}\n\n`);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(keepAlive); if (page === current) { page = null; log('page disconnected'); } });
      log(`page connected (${origin})`); return;
    }
    if (req.method === 'POST' && action === 'result') {
      let size = 0; const chunks = [];
      req.on('data', chunk => { size += chunk.length; if (size > MAX_RESULT_BYTES) { req.destroy(); return; } chunks.push(chunk); });
      req.on('end', () => {
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400, { error: 'invalid JSON' }, origin); return; }
        const waiter = pending.get(body?.id); if (!waiter) { send(res, 404, { error: 'unknown or already expired call' }, origin); return; }
        pending.delete(body.id); clearTimeout(waiter.timer); waiter.resolve(body); send(res, 200, { ok: true }, origin);
      });
      return;
    }
    if (req.method === 'GET' && action === 'file') {   // a local file of an adb call in flight (adb install, adb push), streamed from disk to the page (nothing is kept here)
      const entry = files.get(route.id ?? ''); if (!entry) { send(res, 404, { error: 'unknown file: its adb call has already finished' }, origin); return; }
      cors(origin, res); res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(entry.size), 'cache-control': 'no-store' });
      const stream = createReadStream(entry.file, { start: 0, end: entry.size - 1 }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
    }
    if (req.method === 'POST' && action === 'file') {   // the bytes of a file an adb call in flight writes on this machine (adb pull, `> file`), streamed to disk
      const slot = uploads.get(route.id ?? ''); if (!slot) { send(res, 404, { error: 'unknown output file: its call has already finished' }, origin); return; }
      if (slot.exts && !slot.named) { const ext = url.searchParams.get('ext') ?? ''; if (!slot.exts.includes(ext)) { send(res, 400, { error: `extension not accepted for this file (${slot.exts.join(', ')})` }, origin); return; } slot.dest += `.${ext}`; slot.named = true; }   // a file the bridge named without its extension: the page says which of the allowed ones it is
      const out = createWriteStream(slot.dest, { flags: slot.append ? 'a' : 'w' }); let bytes = 0, failed = false;
      const fail = (status, message) => { if (failed) return; failed = true; out.destroy(); slot.error = message; send(res, status, { error: message }, origin); };
      out.on('error', error => fail(500, `could not write ${slot.dest}: ${error.code ?? error.message}`));
      req.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_APK_BYTES) { fail(413, 'file larger than 1 GiB'); req.destroy(); return; } if (!failed) out.write(chunk); });
      req.on('end', () => { if (failed) return; out.end(() => { if (failed) return; slot.bytes = (slot.bytes ?? 0) + bytes; slot.written = true; send(res, 200, { ok: true, bytes }, origin); }); });
      return;
    }
    if (req.method === 'GET' && action === 'hello') { send(res, 200, { server: SERVER_INFO, connected: !!page }, origin); return; }
    send(res, 404, { error: 'not found' }, origin);
  }
  /** Sends one tool call to the page; resolves with { content, isError }. */
  function callPage(name, args) {
    if (!page) {
      const mismatch = refused && Date.now() - refused.at < 10 * 60 * 1000 ? ` A page of ${refused.origin} tried to connect ${Math.round((Date.now() - refused.at) / 1000)} s ago and was refused by its origin: start the bridge with --origin ${refused.origin} (the command in Controls › Extensions › MCP carries it).` : '';
      return Promise.resolve({ isError: true, content: [{ type: 'text', text: `The APK Web Lab page is not connected. Open the lab in the browser: it connects to the bridge by itself (Controls › Extensions › MCP shows the state).${mismatch}` }] });
    }
    const long = name === 'adb';
    const id = nextId++, wait = name === 'wait_ready' ? Math.max(timeoutMs, Number(args?.timeout_ms ?? 15000) + 5000) : ['debug_wait', 'debug_step', 'debug_run_to'].includes(name) ? Math.max(timeoutMs, Math.min(120000, Number(args?.timeout_ms ?? 10000)) + 10000) : long ? Math.max(timeoutMs, LONG_CALL_MS + (Number(args?.wait_ms) || 15000)) : timeoutMs;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ isError: true, content: [{ type: 'text', text: `The page did not answer in ${Math.round(wait / 1000)} s (tab in the background or busy?).` }] }); }, wait);
      pending.set(id, { resolve: body => resolve(body.ok === false ? { isError: true, content: [{ type: 'text', text: String(body.error ?? 'page failure') }] } : { content: Array.isArray(body.content) ? body.content : [{ type: 'text', text: JSON.stringify(body.content ?? null) }], isError: !!body.isError }), timer });
      page.res.write(`event: call\ndata: ${JSON.stringify({ id, tool: name, args: args ?? {} })}\n\n`);
    });
  }
  /** adb: the local files the command line names are offered to the page (read: install, push) or opened for it to write (pull, > file) for the length of the call. */
  async function adbCall(args) {
    if (!page) return callPage('adb', {});   // says that the page is not connected
    const named = adbLocalFiles(args ?? {}), local = { files: {}, missing: {}, outputs: {} }, ids = [], slots = [];
    const absolute = given => path.resolve(given === '~' || given.startsWith('~/') ? path.join(homedir(), given.slice(1)) : given);
    for (const given of named.reads) {
      const file = absolute(given); let info; try { info = await stat(file); } catch (error) { local.missing[given] = error?.code === 'ENOENT' ? 'No such file or directory (on the machine where the lab-mcp bridge runs)' : String(error?.code ?? error?.message ?? error); continue; }
      if (!info.isFile()) { local.missing[given] = 'not a file'; continue; }
      if (info.size > MAX_APK_BYTES) { local.missing[given] = 'larger than 1 GiB'; continue; }
      const id = randomBytes(16).toString('hex'); files.set(id, { file, size: info.size }); ids.push(id); local.files[given] = { id, name: path.basename(file), size: info.size };
    }
    for (const output of named.writes) {
      let dest = absolute(output.path);
      try { if ((await stat(dest)).isDirectory()) { if (!output.remote) { local.missing[output.key] = 'is a folder'; continue; } dest = path.join(dest, path.basename(output.remote)); } } catch { /* a new file */ }
      try { if (!(await stat(path.dirname(dest))).isDirectory()) throw new Error('not a directory'); } catch { local.missing[output.key] = `the folder ${path.dirname(dest)} does not exist on the machine where the lab-mcp bridge runs`; continue; }
      const id = randomBytes(16).toString('hex'), slot = { dest, append: !!output.append }; uploads.set(id, slot); slots.push(slot); ids.push(id); local.outputs[output.key] = { id };
    }
    try {
      const result = await callPage('adb', { ...(typeof args?.command === 'string' ? { command: args.command } : {}), ...(Array.isArray(args?.args) ? { args: args.args } : {}), local });
      const written = slots.filter(slot => slot.written).map(slot => `file written on this machine: ${slot.dest} (${slot.bytes} bytes)`);
      return written.length ? { ...result, content: [...result.content, { type: 'text', text: written.join('\n') }] } : result;
    } finally { for (const id of ids) { files.delete(id); uploads.delete(id); } }
  }
  /** record_screen stop: the video file is opened here for the page to write, at `path` (a .mp4 / .webm file, or a folder) or under a dated name in the folder the bridge runs in. */
  async function recordCall(args) {
    if (args?.action !== 'stop' || !page) return callPage('record_screen', args ?? {});
    const local = { outputs: {}, missing: {} }, two = value => String(value).padStart(2, '0'), date = new Date(), stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`, auto = `screen-recording-${stamp}`, formats = ['mp4', 'webm'];
    const given = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : null; let dest = path.resolve(given === null ? auto : given === '~' || given.startsWith('~/') ? path.join(homedir(), given.slice(1)) : given), exts = given === null ? formats : null;
    try { if (given !== null && (await stat(dest)).isDirectory()) { dest = path.join(dest, auto); exts = formats; } } catch { /* a new file */ }
    const ext = exts ? null : path.extname(dest).slice(1).toLowerCase(); let id = null, slot = null;
    if (!exts && !formats.includes(ext)) local.missing.recording = `path must end in .mp4 or .webm (or be a folder): ${given}`;
    else { try { if (!(await stat(path.dirname(dest))).isDirectory()) throw new Error('not a directory'); id = randomBytes(16).toString('hex'); slot = { dest, append: false, exts }; uploads.set(id, slot); local.outputs.recording = { id, ext }; } catch { local.missing.recording = `the folder ${path.dirname(dest)} does not exist on the machine where the lab-mcp bridge runs`; } }
    try {
      const { path: _path, ...rest } = args, result = await callPage('record_screen', { ...rest, local });
      return slot?.written ? { ...result, content: [...result.content, { type: 'text', text: `file written on this machine: ${slot.dest} (${slot.bytes} bytes)` }] } : result;
    } finally { if (id) uploads.delete(id); }
  }
  /** One MCP JSON-RPC message -> the response (or null for a notification). */
  async function handle(message) {
    const { id, method, params } = message ?? {}, reply = result => ({ jsonrpc: '2.0', id, result }), fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });
    if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return id === undefined ? null : fail(-32600, 'Invalid Request');
    if (id === undefined || id === null) return null;   // notifications (initialized, cancelled ...)
    switch (method) {
      case 'initialize': return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: 'Tools of the APK Web Lab page open in the browser (an Android app running in the browser). Start with lab_status; screenshot returns images; compose_tree and layout_bounds give handles and keys for the other tools. adb accepts adb command lines (adb help lists the interpreted ones): install, list, open and close apps with it (adb install, pm list packages, am start, am force-stop; one app at a time), deep links (am start -a VIEW -d), Back (input keyevent 4) and permissions (pm grant/revoke). record_screen records the screen as video (start, then stop). code_* tools read the app\'s code (smali, files) and edit it (listed as App modified). Debugging: debug_set_breakpoint, then trigger the code (tap, invoke_method), then debug_wait (location, stack, locals), then debug_step / debug_evaluate / debug_continue and debug_wait again.' });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name; if (!TOOLS.some(tool => tool.name === name)) return fail(-32602, `unknown tool: ${name}`);
        return reply(name === 'adb' ? await adbCall(params?.arguments ?? {}) : name === 'record_screen' ? await recordCall(params?.arguments ?? {}) : await callPage(name, params?.arguments ?? {}));
      }
      default: return fail(-32601, `Method not found: ${method}`);
    }
  }
  return {
    handle, callPage, get connected() { return !!page; },
    listen: () => new Promise((resolve, reject) => { server = http.createServer(onRequest); server.once('error', reject); server.listen(port, host, () => { log(`listening for the page at http://127.0.0.1:${server.address().port} (origins: ${[...allowed].join(', ')})`); resolve(server.address().port); }); }),
    close: () => new Promise(resolve => { for (const waiter of pending.values()) clearTimeout(waiter.timer); pending.clear(); page?.res.end(); if (server) server.close(() => resolve()); else resolve(); }),
  };
}

/** The addresses an MCP client can use for a bridge bound to `host`: the loopback one, and for 0.0.0.0 every local IPv4 of this machine. */
export function mcpAddresses(host, port, interfaces = networkInterfaces()) {
  const hosts = host === '0.0.0.0' ? ['127.0.0.1', ...Object.values(interfaces).flat().filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => entry.address)] : [host];
  return [...new Set(hosts)].map(name => `http://${name}:${port}/mcp`);
}

/** MCP over stdio: one JSON-RPC message per line on stdin, responses on stdout. */
export function serveStdio(bridge, { input = process.stdin, output = process.stdout } = {}) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk; let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (!line) continue;
      let message; try { message = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n'); continue; }
      const batch = Array.isArray(message) ? message : [message];
      for (const item of batch) bridge.handle(item).then(response => { if (response) output.write(JSON.stringify(response) + '\n'); }, error => output.write(JSON.stringify({ jsonrpc: '2.0', id: item?.id ?? null, error: { code: -32603, message: String(error?.message ?? error) } }) + '\n'));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), options = { port: DEFAULT_PORT, host: '127.0.0.1', serve: false, origins: [...DEFAULT_ORIGINS], timeoutMs: 60000 }, ignored = [];
  if (process.env[LEGACY_TOKEN_ENV]) ignored.push(LEGACY_TOKEN_ENV);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'token') { console.error('lab-mcp: there is no pairing token any more; the lab page connects to the bridge by itself.'); process.exit(0); }
    else if (arg === 'serve') options.serve = true;
    else if (arg === '--host') options.host = String(args[++i]);
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--origin') options.origins.push(String(args[++i]).replace(/\/$/, ''));
    else if (arg === '--token') { i++; ignored.push('--token'); }
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++i]);
    else if (arg === '--help' || arg === '-h') { console.error('node lab-mcp.mjs [serve] [--host 127.0.0.1] [--port 8790] [--origin <lab origin>]... [--timeout-ms 60000]'); process.exit(0); }
  }
  const bridge = createBridge(options);
  if (ignored.length) process.stderr.write(`[lab-mcp] ${ignored.join(', ')}: ignored, the bridge has no pairing token any more\n`);
  if (options.host !== '127.0.0.1' && options.host !== 'localhost') process.stderr.write(`[lab-mcp] listening on ${options.host}: ANY machine that reaches this port can drive the lab (there is no token) and the traffic is plain HTTP; use it on networks you trust\n`);
  bridge.listen().then(port => {
    if (!options.serve) { serveStdio(bridge); return; }
    for (const address of mcpAddresses(options.host, port)) process.stderr.write(`[lab-mcp] MCP: ${address}\n`);
    process.stderr.write(`[lab-mcp] in the agent: claude mcp add --transport http apk-lab http://127.0.0.1:${port}/mcp   ·   the lab page connects by itself (Controls › Extensions › MCP shows it)   ·   Ctrl+C stops\n`);
  }, error => { process.stderr.write(`[lab-mcp] could not open port ${options.port}: ${error.message}\n`); process.exit(1); });
  if (!options.serve) process.stdin.on('end', () => bridge.close().then(() => process.exit(0)));
  else for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => bridge.close().then(() => process.exit(0)));
}
