// "Estado da tela": a plain-text picture of what the VM shows and why it may be blank, for "Copiar diagnóstico" and for a button that works without any error. Read-only on the VM.
// Pure data: no app or library names are written here; class names come from the running app and only reach the user's clipboard.
import { reportSummary, collapseThreads } from './report-summary.js?v=6152edcf6e9b';
import { ignoredActivitiesLine } from './ignored-activities.js?v=6152edcf6e9b';
const MiB = 1024 * 1024, BYTES_PER_OBJECT = 1600;
const STAGES = { 0: 'destruída', 1: 'criada', 2: 'parada', 3: 'iniciada/pausada', 4: 'retomada (em primeiro plano)' };
const dotted = type => String(type ?? '?').replace(/^L/, '').replace(/;$/, '').replaceAll('/', '.');
const isCompose = type => /(^|\.)(AndroidComposeView|ComposeView|AbstractComposeView)$/.test(dotted(type));
const sizeOf = view => ({ width: Math.max(0, (view.bounds?.right ?? 0) - (view.bounds?.left ?? 0)), height: Math.max(0, (view.bounds?.bottom ?? 0) - (view.bounds?.top ?? 0)) });
const colorOf = background => background === null || background === undefined ? 'nenhum' : typeof background === 'number' ? '#' + (background >>> 0).toString(16).padStart(8, '0') : typeof background === 'object' ? (background.color !== undefined ? '#' + (background.color >>> 0).toString(16).padStart(8, '0') : background.kind ?? background.type ?? 'drawable') : String(background);

/** The View tree of one root: lines (depth <= maxDepth, at most maxLines) plus aggregate facts used by the blank-screen verdict. */
function walkTree(runtime, root, { maxDepth = 6, maxLines = 80 } = {}) {
  const lines = [], facts = { views: 0, visibleDrawn: 0, zero: 0, invisible: 0, composeHosts: [], truncated: false };
  const seen = new Set();
  const visit = (ref, depth, ancestorsVisible) => {
    const view = runtime.object(ref); if (seen.has(view.id) || seen.size > 4096) return; seen.add(view.id); facts.views++;
    const { width, height } = sizeOf(view), visibility = view.visibility ?? 0, alpha = view.alpha ?? 1, visible = ancestorsVisible && visibility === 0 && alpha > 0;
    if (width === 0 || height === 0) facts.zero++;
    if (!visible) facts.invisible++;
    if (visible && width > 0 && height > 0) facts.visibleDrawn++;
    if (isCompose(view.type)) facts.composeHosts.push({ ref, view, width, height, visible });
    if (depth <= maxDepth) {
      if (lines.length < maxLines) {
        const flags = [];
        if (visibility !== 0) flags.push(visibility === 4 ? 'INVISÍVEL' : 'GONE'); if (alpha === 0) flags.push('alpha=0'); if (width === 0 || height === 0) flags.push('0x0');
        if (view.willNotDraw) flags.push('willNotDraw'); if (view.layoutRequested || view.layoutRequired) flags.push('layout pendente'); if (view.displayListDirty) flags.push('redesenho pendente'); if (view.laidOut === false) flags.push('sem layout'); if (view.attached === false) flags.push('desanexada');
        lines.push(`${'  '.repeat(depth)}${dotted(view.type)}${view.androidId ? ` #${view.androidId}` : ''} [${view.bounds ? `${view.bounds.left},${view.bounds.top},${view.bounds.right},${view.bounds.bottom}` : 'sem bounds'}] filhos=${(view.children ?? []).length} fundo=${colorOf(view.background)}${alpha !== 1 ? ` alpha=${alpha}` : ''}${flags.length ? ' ⚠ ' + flags.join(', ') : ''}`);
      } else facts.truncated = true;
    }
    for (const child of view.children ?? []) visit(child, depth + 1, visible);
  };
  visit(root, 0, true);
  if (facts.truncated) lines.push('  … (árvore truncada)');
  return { lines, facts };
}

function composeFacts(runtime, host, semantics) {
  const out = { size: `${host.width}x${host.height}`, attached: host.view.attached !== false, visible: host.visible };
  const view = host.view, interesting = [];
  for (const [key, value] of view.fields ?? []) if (/composition|recomposer|parentContext|ownerView/i.test(key) && value) interesting.push(key.split('->').pop().split(':')[0]);
  out.fieldsWithValue = interesting;
  const owner = semantics?.owners?.find(candidate => candidate.ownerViewId === view.id);
  out.owner = owner ? { nodes: owner.nodes.length, placed: owner.nodes.filter(n => n.placed).length, withText: owner.nodes.filter(n => n.texts?.length).length, invisible: owner.nodes.filter(n => n.invisibleToUser).length, width: owner.width, height: owner.height, outside: owner.nodes.filter(n => n.placed && n.boundsInRoot && (n.boundsInRoot.right <= 0 || n.boundsInRoot.bottom <= 0 || n.boundsInRoot.left >= owner.width || n.boundsInRoot.top >= owner.height)).length } : null;
  return out;
}

/** { text, blank, reasons[] } for the running VM. `semantics` is the Compose semantics snapshot (optional), `heartbeat` the last monitor snapshot (optional). */
export function buildScreenState(runtime, { semantics = null, heartbeat = null } = {}) {
  const platform = runtime.platform, out = [], reasons = [];
  const tasks = platform.tasks ?? [], frames = platform.allFrames?.() ?? [];
  const top = frames.length ? frames[frames.length - 1] : null;
  out.push('Estado da tela');
  if (runtime.methodOverrides) out.push(`ATENÇÃO: retornos de métodos substituídos ATIVOS (${runtime.methodOverrides.size} métodos): o código original deles não executou; ferramenta de depuração.`);
  if (runtime.platform?.ignoredActivities?.size) out.push(`ATENÇÃO: ${ignoredActivitiesLine(runtime)}; essas aberturas não aconteceram (ferramenta de depuração).`);
  const summaryAt = out.length;
  // ---- activity stack
  out.push('Pilha de Activities (tarefa: Activity, estágio):');
  for (const task of tasks) for (const frame of task.frames) out.push(`  tarefa ${task.id}: ${dotted(frame.type)}, ${STAGES[frame.lifecycleStage] ?? frame.lifecycleStage}${frame.finished ? ', finalizada' : ''}${frame === top ? '  ← topo' : ''}`);
  if (!tasks.length) out.push('  (nenhuma — ' + (platform.taskClosed ? 'a tarefa foi encerrada' : 'nenhuma Activity foi iniciada') + ')');
  // ---- window and view tree
  let roots = []; try { roots = platform.viewRoots?.(runtime) ?? []; } catch { /* no window */ }
  if (!roots.length && runtime.root) roots = [{ root: runtime.root, window: null }];
  const hosts = [];
  if (!roots.length) reasons.push('nenhuma janela/view raiz existe');
  roots.forEach((entry, index) => {
    const rootView = runtime.object(entry.root), { width, height } = sizeOf(rootView);
    out.push(`Janela ${index + 1}${index === roots.length - 1 ? ' (topo)' : ''}: raiz ${dotted(rootView.type)} ${width}x${height}, windowBackground=${colorOf(entry.windowBackground)}`);
    const { lines, facts } = walkTree(runtime, entry.root);
    out.push(...lines.map(line => '  ' + line));
    out.push(`  resumo: ${facts.views} views, ${facts.visibleDrawn} visíveis e com área, ${facts.zero} com 0x0, ${facts.invisible} invisíveis/alpha 0`);
    if (index === roots.length - 1) {
      if (width === 0 || height === 0) reasons.push(`a janela do topo mede ${width}x${height}`);
      else if (facts.views > 0 && facts.visibleDrawn === 0) reasons.push('tudo invisível/0x0: nenhuma view tem área visível');
      hosts.push(...facts.composeHosts);
    }
  });
  // ---- compose
  out.push('Compose:');
  if (!hosts.length) out.push('  nenhuma ComposeView/AndroidComposeView na janela do topo');
  const frameState = platform.viewWindowHost?.frameState?.() ?? null;
  for (const host of hosts) {
    const facts = composeFacts(runtime, host, semantics);
    out.push(`  ${dotted(host.view.type)}: ${facts.size}, ${facts.attached ? 'anexada' : 'DESANEXADA'}, ${facts.visible ? 'visível' : 'INVISÍVEL'}; campos de composição preenchidos: ${facts.fieldsWithValue.join(', ') || 'nenhum'}`);
    if (facts.owner) out.push(`    semântica: ${facts.owner.nodes} nós (${facts.owner.placed} posicionados, ${facts.owner.withText} com texto, ${facts.owner.invisible} invisíveis, ${facts.owner.outside} fora dos limites ${facts.owner.width}x${facts.owner.height})`);
    else out.push('    semântica: sem dono de semântica nesta view' + (/AndroidComposeView$/.test(dotted(host.view.type)) ? ' (a composição não criou nós)' : ' (é o contêiner; os nós ficam na AndroidComposeView)'));
    const wrapper = !/AndroidComposeView$/.test(dotted(host.view.type));
    if (host.width === 0 || host.height === 0) reasons.push('a ComposeView mede 0x0 (recortada a 0)');
    else if (host.view.attached === false) reasons.push('a ComposeView não está anexada à janela');
    else if (wrapper) { if (!facts.fieldsWithValue.includes('composition')) reasons.push('composição não criada: a ComposeView não tem composition'); }
    else if (!facts.owner || facts.owner.nodes === 0) reasons.push('composição não criada: a AndroidComposeView não produziu nenhum nó de semântica');
    else if (facts.owner.placed === 0) reasons.push('a composição existe mas nenhum nó foi posicionado (layout não rodou)');
    else if (facts.owner.outside === facts.owner.placed) reasons.push('todo o conteúdo está além dos limites da janela');
    else if (facts.owner.invisible === facts.owner.nodes) reasons.push('todo o conteúdo está invisível (alpha 0)');
    else if (facts.owner.withText === 0 && facts.owner.placed <= 2) reasons.push('a composição tem poucos nós e nenhum texto');
  }
  if (frameState) {
    out.push(`  relógio de quadros: ${frameState.framesRun} quadros produzidos, ${frameState.callbacksRun} callbacks executados, ${frameState.pendingFrames} pendentes${Number.isFinite(frameState.nextFrameAt) ? ` (próximo em ${Math.round(frameState.nextFrameAt - platform.clock.now())} ms virtuais)` : ''}, callbacks de views desanexadas: ${frameState.detachedCallbacks}`);
    if (hosts.length && frameState.framesRun === 0) reasons.push('nenhum quadro foi produzido (o relógio de quadros nunca rodou)');
    if (hosts.length && frameState.framesRun === 0 && frameState.pendingFrames === 0) reasons.push('nenhum callback de quadro está agendado: a composição não pediu quadro');
  }
  out.push(`  primeiro quadro confirmado: ${(frameState?.framesRun ?? 0) > 0 || (platform.lastFrameMs ?? 0) > 0 ? 'sim' : 'não'}`);
  // ---- bars and insets
  let bars = null; try { bars = platform.systemBarsHost?.snapshot?.(runtime) ?? null; } catch { /* not modelled */ }
  out.push(`Barras do sistema/insets: ${bars ? JSON.stringify(bars).slice(0, 400) : 'não disponíveis'}`);
  // ---- queued work
  const now = platform.clock.now(), queue = platform.eventQueue ?? [];
  out.push(`Fila de eventos (${queue.length}, agora=${Math.round(now)} ms virtuais):`);
  for (const event of queue.slice(0, 12)) {
    let what; try { what = event.platformTask ? `tarefa do host ${event.platformTask.name || '(anônima)'}` : event.windowFrameTime !== undefined ? 'quadro (Choreographer)' : `Handler ${dotted(runtime.typeOf(event.handler))} → ${platform.looperHost.callbackOf(runtime, event.message) ? dotted(runtime.typeOf(platform.looperHost.callbackOf(runtime, event.message))) : 'what=' + platform.looperHost.whatOf(runtime, event.message)}`; } catch { what = 'evento'; }
    out.push(`  em ${Math.round((event.when ?? now) - now)} ms: ${what}`);
  }
  if (queue.length > 12) out.push(`  … +${queue.length - 12}`);
  // ---- why layout is pending
  const layout = platform.viewLayoutHost?.detail?.(runtime), scheduler = runtime.scheduler, mainThread = scheduler.main;
  if (layout) {
    out.push(`Layout: ${layout.pending ? 'PENDENTE' : 'sem passada pendente'}; tarefa de medição/layout na fila: ${layout.queued ? 'sim' : 'não'}`);
    for (const root of layout.roots) out.push(`  raiz ${dotted(root.type)}: ${root.attached ? 'anexada' : 'NÃO anexada à janela (a passada só é agendada depois de anexar)'}, tarefa ${root.queued ? 'na fila' : 'não agendada'}`);
    if (layout.pending && layout.roots.some(root => root.attached)) {
      const head = queue[0], running = runtime.thread?.frames?.length > 0;
      const mainState = mainThread ? `${mainThread.state}${mainThread.blocked ? ` (${mainThread.blocked.reason ?? 'espera'})` : ''}` : 'sem thread principal';
      out.push(`  por que não rodou: ${running ? 'uma thread está executando código Java agora (evento em andamento; a passada só roda entre eventos)' : mainThread?.state === 'blocked' ? `a thread principal está bloqueada: ${mainState}` : head && (head.when ?? now) > now ? `o próximo evento só vence em ${Math.round(head.when - now)} ms virtuais` : 'a fila tem eventos antes da passada de layout'}; thread principal: ${mainState}`);
    }
  }
  const shortKey = key => String(key ?? '?').replace(/^L/, '').replace(/;->/, '.');
  const wakeOp = runtime.monitor.op ?? (runtime.monitor.lastWakes ? { wakes: runtime.monitor.lastWakes } : null); if (wakeOp?.wakes?.size) out.push('Despertares de threads nesta operação (thread · primitiva · causa): ' + runtime.monitor.wakeRows(wakeOp, 5).map(row => `${row.count}× ${row.key}`).join('; '));
  out.push(runtime.monitor.executionLine());
  const anonymous = [...(platform.anonymousTaskSites ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 6);
  out.push(`Tarefas do host sem lista de raízes (enfileiradas com raízes conservadoras), por origem: ${anonymous.length ? anonymous.map(([site, count]) => `${count}× ${site}`).join('; ') : 'nenhuma'}`);
  out.push('Threads (nome, estado, espera, 6 quadros mais internos):');
  const collapsed = collapseThreads(runtime, scheduler.threads, mainThread);
  for (const group of collapsed.groups) out.push(`  ${group} (espera ociosa de pool; omitidas)`);
  for (const thread of [...(mainThread ? [mainThread] : []), ...collapsed.shown.filter(candidate => candidate !== mainThread)]) {
    const frames = (thread.frames ?? []).slice(-6).reverse().map(frame => frame.method ? shortKey(frame.method.key) : frame.cont ? '(chamada do host)' : '?');
    let target = ''; try { if (thread.blocked) target = `esperando: ${thread.blocked.reason ?? '?'}${thread.blocker ? ' em ' + dotted(runtime.typeOf(thread.blocker)) : ''}`; } catch { target = `esperando: ${thread.blocked?.reason ?? '?'}`; }
    out.push(`  ${thread.name}${thread === mainThread ? ' [main]' : ''}: ${thread.state}${thread.nestedDepth ? `, dentro de chamada nativa aninhada (${thread.nestedDepth})` : ''}${target ? ', ' + target : ''}${runtime.initDepth && thread.state === 'blocked' && /class init/i.test(String(thread.blocked?.reason)) ? ' [inicialização de classe]' : ''}`);
    for (const frame of frames) out.push(`      ${frame}`);
  }
  if (heartbeat) out.push(`Último sinal da VM: ${heartbeat.operation ?? 'ocioso'}, ${heartbeat.thread ?? 'sem thread'}, chamada do host: ${heartbeat.hostCall ?? 'nenhuma'}, eventos: ${heartbeat.events}, instruções: ${heartbeat.instructions}`);
  // ---- memory
  const live = runtime.heap.size, mib = Math.round(live * BYTES_PER_OBJECT / MiB);
  out.push(`Memória da VM: ${live} objetos de ${runtime.maxHeapObjects} (${Math.round(100 * live / runtime.maxHeapObjects)}%), ~${mib} MiB estimados; coletas: ${runtime.gcStats?.collections ?? 0}`);
  // ---- swallowed exceptions
  const caught = runtime.caughtExceptions;
  out.push(`Exceções capturadas pelo código do app e descartadas (${caught?.total ?? 0} no total; primeiras ${Math.min(15, caught?.distinct.size ?? 0)} distintas):`);
  for (const [, entry] of [...(caught?.distinct ?? [])].slice(0, 15)) out.push(`  ${entry.count}× ${entry.type}${entry.message ? ': ' + entry.message : ''}  (capturada em ${entry.where})`);
  if (!caught?.total) out.push('  (nenhuma)');
  { const uncaught = runtime.uncaughtText?.(); if (uncaught) out.push(uncaught); }
  { const failed = runtime.threadFailureText?.(); if (failed) out.push(failed); }
  const blank = reasons.length > 0;
  // The "Tela:" lines of the summary, read back from the sections above (activity on top, first-frame verdict, Compose, layout)
  const tela = [], find = pattern => out.find(line => pattern.test(line));
  { const top = find(/← topo/)?.trim().replace(/^tarefa \d+: /, '').replace(/\s+← topo$/, ''); tela.push(`Tela: ${top ?? 'nenhuma Activity'} — ${blank ? 'primeiro quadro em BRANCO: ' + reasons.join('; ') : 'a tela tem conteúdo'}`);
    const semantics = find(/semântica: \d+ nós/)?.trim(), frames = find(/relógio de quadros:/)?.trim(); if (semantics || frames) tela.push(`  Compose: ${[semantics?.replace(/^semântica: /, 'semântica '), frames?.replace(/^relógio de quadros: /, 'quadros ')].filter(Boolean).join('; ')}`);
    const layout = find(/^Layout: /), why = find(/por que não rodou:/)?.trim(); if (layout) tela.push(`  ${layout}${why ? '; ' + why : ''}`); }
  out.splice(summaryAt, 0, ...reportSummary(runtime, { heartbeat, tela }));
  if (blank) out.splice(1, 0, `primeiro quadro em branco — motivo(s): ${reasons.join('; ')}`);
  else out.splice(1, 0, 'a tela tem conteúdo: nenhum motivo de tela em branco encontrado');
  return { text: spaced(out), blank, reasons, tela };
}

/** The report as text with room between its parts: each entry of the Resumo is set off by a blank line, and each section after it (Activities, windows, Compose, queue, threads, memory,
 * exceptions...) starts after a blank line and a rule, so that a photo or a printout shows where one part ends. Lines that start with spaces stay with the entry above them. */
function spaced(lines) {
  const RULE = '────────────────────────────────────────';
  const out = []; let inSummary = false;
  lines.flatMap(entry => String(entry).split('\n')).forEach((line, index) => {   // a part that returned several lines at once (execution, GC) is split so each of its sections is set off too
    if (line === '== Resumo ==') { out.push('', line); inSummary = true; return; }
    if (line === '== fim do resumo ==') { out.push('', line); inSummary = false; return; }
    const topLevel = index > 1 && line !== '' && !/^\s/.test(line);
    if (topLevel && inSummary) out.push('');
    else if (topLevel) out.push('', RULE);
    out.push(line);
  });
  return out.join('\n');
}
