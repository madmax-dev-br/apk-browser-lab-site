// The compact block at the very top of "Copiar diagnóstico" and "Estado da tela": what a person photographing the screen needs first -- memory, who holds it, the one-line uncaught exceptions,
// the main thread and the busiest methods. The long sections (threads, queue, profile, log) follow it.
import { TimeBreakdown } from './time-breakdown.js?v=a9aeb2c97f5b';
import { staticRetentionLines } from './heap-gc.js?v=a9aeb2c97f5b';
import { overrideSummaryLines } from './method-overrides.js?v=a9aeb2c97f5b';
import { ignoredActivitiesLine } from './ignored-activities.js?v=a9aeb2c97f5b';
import { endpointMockSummaryLines } from './endpoint-mocks.js?v=a9aeb2c97f5b';
import { hostMapSummaryLines } from './host-map.js?v=a9aeb2c97f5b';
const dotted = type => String(type ?? '?').replace(/^L|;$/g, '').replaceAll('/', '.');
const MiB = 1048576, BYTES_PER_OBJECT = 1600;

/** Lines of the summary for `runtime`; never throws (every part is optional). */
/** When the monitor the main thread waits on belongs to a java.lang.Thread (HandlerThread.getLooper waits on the HandlerThread until its run() reached Looper.prepare): that thread's name, state, whether it started, ran run(), died, and whether Looper.prepare was reached. */
function threadObjectNote(runtime, target) {
  const type = runtime.typeOf(target); if (!runtime.isSubtype(type, 'Ljava/lang/Thread;')) return null;
  const id = runtime.object(target).id, vt = (runtime.scheduler.threads ?? []).find(t => t.javaObject && runtime.object(t.javaObject).id === id);
  const handlerThread = runtime.isSubtype(type, 'Landroid/os/HandlerThread;'), label = handlerThread ? 'HandlerThread' : 'Thread';
  if (!vt) return `  a thread esperada é um ${dotted(type)} (${label}) que o escalonador não conhece: start() ainda não foi chamado ou a thread já foi descartada`;
  const looper = handlerThread ? runtime.object(target).fields.get('Landroid/os/HandlerThread;->mLooper:Landroid/os/Looper;') : undefined;
  const crash = [...(runtime.uncaughtExceptions?.values() ?? [])].find(entry => entry.thread === vt.name);
  const parts = [`${label} "${vt.name}" (${dotted(type)}): estado ${vt.state}`, vt.started ? 'start() foi chamado' : 'start() ainda não foi chamado'];
  const ran = vt.began || vt.finished || (vt.frames?.length ?? 0) > 0; parts.push(ran ? 'run() já executou' : 'run() ainda não começou a executar (a thread não foi escalonada)');
  if (handlerThread) parts.push(looper ? 'Looper.prepare foi alcançado' : 'Looper.prepare ainda não foi alcançado (getLooper continua esperando)');
  if (vt.finished) parts.push(crash ? `terminou com a exceção ${crash.type.split('.').pop()}${crash.message ? ': ' + crash.message.slice(0, 100) : ''}` : 'terminou sem exceção registrada');
  else if (vt.frames?.length) parts.push(`agora em ${vt.frames.filter(frame => frame.method).slice(-3).reverse().map(frame => `${dotted(frame.method.owner)}.${frame.method.name}`).join(' ← ')}`);
  return `  ${parts.join('; ')}`;
}

export function reportSummary(runtime, { heartbeat = null, error = null, tela = null } = {}) {
  const out = ['== Resumo ==']; const part = fn => { try { fn(); } catch { /* a part of the summary is unavailable */ } };
  part(() => {   // a VM error: its message and the innermost Java frames (the message lists them outermost first), so one photo has them
    const message = error?.message; if (!message || error?.details?.jsStack) return;
    const frames = [...String(message).matchAll(/(L[^\s:]+?;->[^\s]+?) \[[^\]]+\] at PC (0x[\da-f]+)/gi)].map(([, frame, pc]) => `${dotted(frame.split('->')[0])}.${frame.split('->')[1].replace(/\(.*$/, '')}@${pc}`);
    const text = String(message).replace(/^(?:L[^\s:]+?;->[^\s]+? \[[^\]]+\] at PC 0x[\da-f]+: )+/i, '');
    out.push(`ERRO DA VM: ${text.slice(0, 240)}`); if (frames.length) out.push(`  em: ${frames.slice(-6).reverse().join(' ← ')}`);
  });
  part(() => {   // an internal JavaScript error: its own message and the top frames, so one photo has them
    const stack = error?.details?.jsStack; if (!stack) return;
    const lines = String(stack).split('\n'); out.push(`ERRO INTERNO: ${lines[0]}`);
    const frames = lines.slice(1).filter(line => /\bat\b/.test(line)).slice(0, 3).map(line => line.trim().replace(/file:\/\/\/[^ )]*\//g, '').replace(/^at /, ''));
    if (frames.length) out.push(`  em: ${frames.join(' ← ')}`);
  });
  part(() => {   // (a) memory
    if (runtime.engine === 'wasm' && runtime.wasm) {   // the core's heap is counted in bytes, not in records of the JavaScript VM
      const m = runtime.wasm.memoryInfo();
      out.push(`Memória (núcleo Wasm): heap de ${Math.round(m.heapBytes / MiB)} MiB; ${m.handles} objetos com handle no host; ${m.collections ? `${m.collections} coletas, a última deixou ${m.liveObjects} objetos vivos (~${Math.round(m.liveBytes / MiB)} MiB)` : 'nenhuma coleta ainda'}`);
      return;
    }
    const live = runtime.heap.size, limit = runtime.maxHeapObjects, last = runtime.gcPhases?.[0];
    out.push(`Memória: ${live} de ${limit} objetos vivos (${Math.round(100 * live / limit)}%), ~${Math.round(live * BYTES_PER_OBJECT / MiB)} MiB estimados; ${last ? `última coleta liberou ${last.before - last.after} (${last.before} → ${last.after}); ${runtime.gcStats?.collections ?? 0} coletas` : 'nenhuma coleta ainda'}${runtime.gcDeferralStats ? `, ${runtime.gcDeferralStats.episodes} adiadas durante movimento (${runtime.gcDeferralStats.idle} em repouso, ${runtime.gcDeferralStats.forced} forçadas pelo teto)` : ''}${runtime.oomCount ? `; OutOfMemoryError ${runtime.oomCount}×` : ''}`);
  });
  part(() => {   // renderer (src/gpu-raster.js): only when the experimental GPU replay was selected in this session; a fallback to CPU is never silent
    const gpu = runtime.gpuRaster; if (!gpu) return; const s = gpu.status();
    out.push(s.active === 'gpu' ? `Renderização: GPU (experimental, ${s.api ?? 'WebGL'}${s.gpuRenderer ? `, ${s.gpuRenderer}` : ''}): ${s.frames} quadros, ${s.gpuMs} ms, máx. ${s.maxMs} ms` : s.requested === 'gpu' || s.reason ? `Renderização: CPU — GPU indisponível: ${s.reason ?? 'desconhecido'}` : 'Renderização: CPU (padrão)');
  });
  part(() => { const lines = overrideSummaryLines(runtime); if (lines) out.push(...lines); });   // debugging tool in use: never silent (src/method-overrides.js)
  part(() => { const line = ignoredActivitiesLine(runtime); if (line) out.push(line); });   // debugging tool in use: never silent (src/ignored-activities.js)
  part(() => { const lines = endpointMockSummaryLines(runtime); if (lines) out.push(...lines); });   // debugging tool in use: never silent (src/endpoint-mocks.js)
  part(() => { const lines = hostMapSummaryLines(runtime.network?.policy?.hostMap ?? runtime.platform?.device?.network?.hostMap, runtime.network?.redirectTable); if (lines) out.push(...lines); });   // "Redirecionar hosts" in use: never silent (src/host-map.js)
  if (tela?.length) out.push(...tela);   // "Tela:" lines computed by the screen-state report (activity, first frame verdict, Compose, layout)
  part(() => {   // fatal exceptions the tolerant mode let pass: never silent
    const table = runtime.toleratedFatals; if (!table?.size) return;
    out.push(`FATAL (tolerada) — o modo tolerante deixou o app continuar; só a thread que falhou terminou (${[...table.values()].reduce((sum, e) => sum + e.count, 0)} ocorrências, ${table.size} distintas):`);
    for (const e of [...table.values()].slice(0, 4)) out.push(`  ${e.count}× ${e.type}${e.message ? ': ' + e.message.slice(0, 140) : ''} [${[...e.threads].slice(0, 3).join(', ')}]${e.stack?.length ? '  em ' + e.stack.slice(0, 6).map(frame => String(frame).split('.').slice(-2).join('.')).join(' ← ') : ''}`);
  });
  part(() => {   // the app crash: the default handler (KillApplicationHandler) ended the run
    const crash = runtime.appCrash; if (!crash) return;
    out.push(`FATAL EXCEPTION: ${crash.thread}: ${crash.type}${crash.message ? ': ' + crash.message.slice(0, 140) : ''}${crash.stack?.length ? '  em ' + crash.stack.slice(0, 6).map(frame => String(frame).split('.').slice(-2).join('.')).join(' ← ') : ''}${crash.phase ? ` (fase: ${crash.phase}, ${crash.atMs} ms virtuais)` : ''}`);
  });
  part(() => {   // every OutOfMemoryError: which limit, where
    const log = runtime.oomLog; if (!log?.length) return;
    for (const entry of log.slice(-3)) {
      out.push(`OOM (${entry.kind}) em ${entry.thread ?? '?'}: ${entry.frames.join(' ← ') || entry.hostCall || 'código do host'}; objetos ${entry.objects}/${entry.maxObjects}, campos ${entry.fieldSlots}/${entry.maxFieldSlots}, células de arrays ${entry.arrayCells}/${entry.maxArrayCells} (ponderadas pela largura do elemento), de coleções ${entry.collectionCells}/${entry.maxCollectionCells}${entry.reason ? `; motivo: ${entry.reason}` : ''}${entry.gcTries ? `; coletor: ${entry.gcTries.calls ?? 0} safepoints pediram coleta (${entry.gcTries.notDue ?? 0} não devidas), puladas ${JSON.stringify(entry.gcSkips ?? {})}, ${entry.sinceGc} alocados desde a última coleta` : ''}${entry.gcEmergency?.attempts ? `; coleta de emergência na alocação: ${entry.gcEmergency.attempts} tentativas, ${entry.gcEmergency.ran} executadas (${entry.gcEmergency.freed} objetos liberados), bloqueios ${JSON.stringify(entry.gcEmergency.blocked)}` : ''}; ${entry.soft ? `referências suaves: a coleta sob pressão (política ${entry.soft.policy}) limpou ${entry.soft.cleared} de ${entry.soft.softReferences}, ${entry.soft.totalCleared} no total` : 'nenhuma referência suave foi limpa'}`);
      const a = entry.arrays; if (a) {
        out.push(`  arrays no OOM: ${a.liveCells} células ponderadas vivas e ${a.garbageCells} inalcançáveis ainda não coletadas (contador ${a.cellsInUse}); acima de 1 M de células: ${a.liveOver1M.arrays} vivos (${a.liveOver1M.cells} células) e ${a.garbageOver1M.arrays} inalcançáveis (${a.garbageOver1M.cells} células)`);
        for (const c of a.liveTop) out.push(`    vivo: ${c.type} comprimento ${c.length} elementos (${c.cells} células ponderadas), mantido por ${c.root}`);
        for (const c of a.garbageTop.slice(0, 3)) out.push(`    inalcançável: ${c.type} comprimento ${c.length} elementos (${c.cells} células ponderadas)`);
      }
    }
  });
  part(() => {   // soft references cleared under pressure (heap-gc.js softPolicy) and which static fields hold the heap (computed on OutOfMemoryError and by the heap census)
    const stats = runtime.gcStats, soft = runtime.gcSoftLast;
    if (soft || stats?.softCleared) out.push(`referências suaves: ${stats?.softCleared ?? 0} referentes limpos em ${stats?.softCollections ?? 0} coletas sob pressão${soft ? `; a última (política ${soft.policy}) limpou ${soft.cleared} de ${soft.softReferences} e liberou ${soft.freed} objetos` : ''}`);
    out.push(...staticRetentionLines(runtime.gcStaticRetention));
  });
  part(() => {   // (b) survivors, (c) who keeps them, retention paths
    const last = runtime.gcPhases?.[0]; if (!last) return;
    if (last.survivorsByCount?.length) out.push(`sobreviventes (por quantidade): ${last.survivorsByCount.slice(0, 8).map(c => `${c.n} ${c.type}`).join(', ')}`);
    if (last.survivorsByBytes?.length) out.push(`sobreviventes (por bytes estimados): ${last.survivorsByBytes.slice(0, 8).map(c => `${Math.round(c.bytes / 1024)} KiB ${c.type}`).join(', ')}`);
    if (last.categories?.length) {
      out.push(`quem mantém vivo (primeira raiz que alcança): ${last.categories.slice(0, 6).map(c => `${c.n} ${c.name}`).join('; ')}`);
      const top = last.categories[0]?.topClass; if (top) out.push(`  maior grupo "${last.categories[0].name}": principalmente ${top.n} ${top.type}`);
    }
    if (last.byDex?.length) out.push(`vivos por origem da classe: ${last.byDex.map(d => `${d.n} ${d.dex}`).join(', ')}`);
    const retention = runtime.gcRetention;
    if (retention?.paths?.length) out.push(`exemplo de retenção (${dotted(retention.type)}):`, ...retention.paths.map(path => `  ${path}`));
  });
  part(() => {   // (d) one line per thread
    const table = runtime.uncaughtExceptions; if (!table?.size) return;
    out.push('exceções não tratadas (uma linha por thread; pilhas completas mais abaixo):');
    const shortFrame = frame => String(frame).split('.').slice(-2).join('.');
    for (const entry of [...table.values()].reverse().slice(0, 8)) {
      out.push(`  exceção original (${entry.thread}${entry.count > 1 ? `, ${entry.count}x` : ''}): ${entry.type.split('.').pop()}${entry.message ? ': ' + entry.message.slice(0, 140) : ''}${entry.stack?.length ? '  em ' + entry.stack.slice(0, 6).map(shortFrame).join(' ← ') : ''}`);
      if (entry.handlerFailure) { const h = entry.handlerFailure; out.push(`    o tratador também falhou: ${h.type.split('.').pop()}${h.message ? ': ' + h.message.slice(0, 140) : ''}${h.stack?.length ? '  em ' + h.stack.slice(0, 6).map(shortFrame).join(' ← ') : ''}`); }
    }
  });
  part(() => {   // (e) main thread
    const main = runtime.scheduler?.main; if (!main) return;
    const frames = (main.frames ?? []).slice(-8).reverse().map(frame => frame.method ? `${dotted(frame.method.owner)}.${frame.method.name}` : frame.cont ? '(chamada do host)' : '?');
    { const target = main.blocked?.blocker ?? main.blocker;
      if (main.blocked && target && !(main.blocker)) { try {
        const record = runtime.object(target), owner = runtime.monitors?.get(record.id)?.owner;
        const releasers = (runtime.scheduler.threads ?? []).filter(t => t !== main && (t.state === 'runnable' || (t.state === 'blocked' && Number.isFinite(t.blocked?.deadline)))).slice(0, 4).map(t => `${t.name} ${t.state}`);
        out.push(`a thread principal espera no monitor de um ${dotted(runtime.typeOf(target))} (${main.blocked.reason}); ${owner ? `monitor em poder de ${owner.name}` : 'nenhuma thread detém o monitor'}; podem chamar notify: ${releasers.join(', ') || 'nenhuma thread ativa'}`);
        const thread = threadObjectNote(runtime, target); if (thread) out.push(thread);
      } catch { /* the monitor object is not inspectable */ } } }
    if (main.blocked && main.blocker) { try { const releasers = (runtime.scheduler.threads ?? []).filter(t => t !== main && (t.state === 'runnable' || (t.state === 'blocked' && Number.isFinite(t.blocked?.deadline)))).slice(0, 4).map(t => `${t.name} ${t.state}${t.frames?.length ? ' em ' + (t.frames.at(-1).method ? dotted(t.frames.at(-1).method.owner).split('.').pop() + '.' + t.frames.at(-1).method.name : '(host)') : ''}`); out.push(`a thread principal espera por um ${dotted(runtime.typeOf(main.blocker))}; podem liberá-lo: ${releasers.join(', ') || 'nenhuma thread ativa'}`); } catch { /* blocker not inspectable */ } }
    out.push(`thread principal: ${main.state}${main.blocked ? ` (${main.blocked.reason ?? 'espera'})` : ''}${main.nestedDepth ? `, dentro de chamada nativa aninhada (${main.nestedDepth})` : ''}${frames.length ? '; ' + frames.join(' ← ') : '; sem frames Java (ociosa no looper' + (runtime.lastHostCall ? `, última chamada do host ${String(runtime.lastHostCall).replace(/^L|;->/g, m => m === ';->' ? '.' : '').replaceAll('/', '.')}` : '') + ')'}`);
    // the longest episode of the main thread inside one event (kept after it ended): where it was, what it was doing, the hottest methods of the last seconds
    { const busy = runtime.monitor?.mainBusy;
      if (busy) out.push(`principal ocupada há ${(busy.busyMs / 1000).toFixed(0)} s num único evento (${busy.event})${busy.capped ? `; evento encerrado pelo limite após ${(busy.endedAfterMs / 1000).toFixed(0)} s (a pilha já foi desfeita: os frames abaixo são os da última amostra)` : busy.ended ? `; o evento terminou após ${(busy.endedAfterMs / 1000).toFixed(0)} s` : ' e ainda está em execução'}; laço da thread principal: ${busy.hot.join(', ') || '(sem amostras)'}; frames mais internos: ${busy.frames.join(' <- ') || '(nenhum)'}${busy.hostCall ? `; dentro da chamada do host ${busy.hostCall}${busy.resourceCall ? ` (${busy.resourceCall})` : ''}` : ''}${busy.overdue?.count ? `; ${busy.overdue.count} mensagens atrasadas, a mais antiga há ${(busy.overdue.oldestMs / 1000).toFixed(1)} s` : ''}`); }
    for (const line of runtime.sampler?.lines?.() ?? []) out.push(line);   // the sampled profile of the last 30 s: the busiest threads and their stacks, independent of any event boundary
    // park / wait details: what it waits on, with or without a deadline, and who could release it -- also when the thread is already runnable (woken, not yet resumed)
    if (main.blocked) {
      const now = runtime.platform?.clock?.now?.() ?? 0, deadline = main.blocked.deadline, timed = Number.isFinite(deadline);
      const blockerClass = main.blocker ? dotted(runtime.typeOf(main.blocker)) : main.blocked.blocker ? dotted(runtime.typeOf(main.blocked.blocker)) : 'nenhum (park sem LockSupport.getBlocker)';
      const releasers = (runtime.scheduler.threads ?? []).filter(t => t !== main && (t.state === 'runnable' || (t.state === 'blocked' && Number.isFinite(t.blocked?.deadline)))).slice(0, 5).map(t => `${t.name} ${t.state}`);
      out.push(`  espera: ${main.blocked.reason ?? '?'}; ${timed ? `com prazo em ${Math.round(deadline - now)} ms` : 'sem prazo'}; objeto bloqueador: ${blockerClass}; ${main.state === 'runnable' ? 'já foi acordada e aguarda ser retomada; ' : ''}threads que podem liberá-la (unpark/notify): ${releasers.join(', ') || 'nenhuma'}`);
    }
    // main-looper messages the thread owes: queued events already due
    { const queue = runtime.platform?.eventQueue ?? [], now = runtime.platform?.clock?.now?.() ?? 0, overdue = queue.filter(event => !event.front && Number.isFinite(event.when) && event.when < now - 50);
      if (overdue.length) {
        const oldest = Math.max(...overdue.map(event => now - event.when)), top = frames[0] ?? (runtime.lastHostCall ? `chamada do host ${runtime.lastHostCall}` : 'o looper (ocioso)');
        out.push(`${overdue.length} mensagens do Looper principal atrasadas, a mais antiga há ${(oldest / 1000).toFixed(1)} s, aguardando a thread principal sair de: ${top}`);
      } }
  });
  part(() => { const tb = runtime.tb?.snapshot(); if (tb) { for (const p of tb.pollers ?? []) {
      out.push(`thread ${p.thread} está em polling (${p.perSecond} chamadas do host/s): ${p.calls.map(([key, n]) => `${key} ${n}×`).join(', ')}`);
      // where the loop is: the innermost frames of that thread, application code first (the loop and its exit condition live in the innermost app method)
      const thread = runtime.scheduler?.threads?.find(candidate => candidate.name === p.thread), frames = (thread?.frames ?? []).filter(frame => frame.method).reverse();
      const app = frames.filter(frame => !runtime.dex.bootDexes?.has(frame.method.dex)), chosen = (app.length ? app : frames).slice(0, 4);
      if (chosen.length) out.push(`  laço em: ${chosen.map(frame => `${dotted(frame.method.owner)}.${frame.method.name}`).join(' ← ')} (a condição de saída está no método mais interno)`);
    } out.push(TimeBreakdown.text(tb)); } });   // where the host time of this operation went
  part(() => {   // the virtual clocks, all on one timeline, and where the queue head sits
    const clock = runtime.platform?.clock; if (!clock?.readings) return; const c = clock.readings(), queue = runtime.platform.eventQueue ?? [];
    const whens = queue.map(event => event.when ?? c.uptime).sort((a, b) => a - b);
    out.push(`Relógios: uptimeMillis ${Math.round(c.uptime)}, elapsedRealtime ${Math.round(c.elapsedRealtime)}, nanoTime−uptime ${c.nanoMinusUptimeUs} µs, currentTimeMillis−(origem+uptime) ${c.wallMinusTimelineMs} ms; tempo virtual adiantado ${c.skippedMs} ms de ${Math.round(c.uptime)} ms${whens.length ? `; fila: primeiro evento em ${Math.round(whens[0] - c.uptime)} ms, último em ${Math.round(whens.at(-1) - c.uptime)} ms` : ''}`);
  });
  part(() => {   // the Handler targets that keep recurring in the event queue
    const queue = runtime.platform?.eventQueue ?? []; if (!queue.length) return;
    const now = runtime.platform.clock.now(), groups = new Map();
    for (const event of queue) {
      let what; try { what = event.platformTask ? `tarefa do host ${event.platformTask.name || '(anônima)'}` : event.windowFrameTime !== undefined ? 'quadro (Choreographer)' : `${dotted(runtime.typeOf(event.handler)).split('.').pop()} → ${runtime.platform.looperHost.callbackOf(runtime, event.message) ? dotted(runtime.typeOf(runtime.platform.looperHost.callbackOf(runtime, event.message))) : 'what=' + runtime.platform.looperHost.whatOf(runtime, event.message)}`; } catch { what = '(mensagem)'; }
      const group = groups.get(what) ?? groups.set(what, { n: 0, overdue: -Infinity }).get(what); group.n++; group.overdue = Math.max(group.overdue, now - (event.when ?? now));
    }
    out.push(`fila de eventos (${queue.length}): ${[...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([what, g]) => `${g.n}× ${what}${g.overdue > 0 ? `, atraso máx ${Math.round(g.overdue)} ms` : ''}`).join('; ')}`);
  });
  part(() => {   // a thread that has been executing for a long time without returning
    const tb = runtime.tb?.snapshot(); if (!tb) return;
    for (const [name, ms] of tb.threads ?? []) {
      if (ms < 10000) continue;
      const thread = runtime.scheduler?.threads?.find(candidate => candidate.name === name); if (!thread || !(thread.frames?.length > 0)) continue;
      const frames = thread.frames.filter(frame => frame.method).slice(-6).reverse().map(frame => `${dotted(frame.method.owner)}.${frame.method.name}`);
      const hot = runtime.profile?.topOf?.(name, 3) ?? [];
      out.push(`thread ${name} executando há ${Math.round(ms / 1000)} s sem retornar (${thread.state}): ${frames.join(' ← ') || '(sem quadros Java)'}${hot.length ? `; métodos mais quentes: ${hot.join(', ')}` : ''}`);
    }
  });
  part(() => {   // (f) busiest methods
    const busiest = heartbeat?.busiest?.length ? heartbeat.busiest : runtime.profile?.top?.(5);
    if (busiest?.length) out.push(`métodos mais ocupados: ${busiest.slice(0, 5).join(', ')}`);
  });
  return out.length > 1 ? [...out, '== fim do resumo =='] : [];
}

const IDLE_WAIT = /LockSupport\.park|Unsafe\.park|Object\.wait|ThreadPoolExecutor\.getTask|ConditionObject\.await|CountDownLatch\.await|Semaphore\.acquire|SynchronousQueue|LinkedBlockingQueue\.take|DelayedWorkQueue|AbstractQueuedSynchronizer|Thread\.sleep|CoroutineScheduler\$Worker\.park|parkNanos|\.awaitNanos|Looper\.loop/;
/** Groups threads by name pattern and state; returns { groups: ['45× pool-N-thread-N [blocked: LockSupport.park]'], shown: [threads worth printing in full] }. */
export function collapseThreads(runtime, threads, mainThread) {
  const groups = new Map(), shown = [];
  for (const thread of threads) {
    const frames = (thread.frames ?? []).slice(-4).map(frame => frame.method?.key ?? '');
    const idle = thread !== mainThread && thread.state === 'blocked' && (frames.length === 0 || frames.some(key => IDLE_WAIT.test(key)));
    if (!idle) { shown.push(thread); continue; }
    const pattern = String(thread.name ?? '?').replace(/\d+/g, 'N'), reason = thread.blocked?.reason ?? 'espera', key = `${pattern} [${thread.state}: ${reason}]`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return { groups: [...groups].sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n}× ${key}`), shown };
}
