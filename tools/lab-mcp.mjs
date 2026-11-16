#!/usr/bin/env node
// MCP bridge for APK Web Lab: lets an MCP client (Claude Desktop, Claude Code ...) use the lab page that is open in your browser: screenshots of the screen or of one component,
// the output of the running plugins, the Compose tree and CompositionLocals, ViewModels and static state, Logcat and the network log, "Tela pronta".
// A web page cannot accept connections, so this small process sits between them:
//
//   MCP client  --stdio (JSON-RPC, MCP)-->  lab-mcp.mjs  <--HTTP on 127.0.0.1 (events + results)--  the lab page (Controles > MCP > Conectar)
//
//   node lab-mcp.mjs                      run by the MCP client, configured with the JSON the page shows in Controles › MCP:
//                                         { "mcpServers": { "apk-lab": { "command": "node", "args": ["/caminho/lab-mcp.mjs"], "env": { "APK_WEB_LAB_MCP_TOKEN": "<token da página>" } } } }
//   node lab-mcp.mjs serve --token <t>    the simple way: stays running and serves MCP over HTTP at http://<host>:<port>/mcp/<token> (Streamable HTTP, JSON responses), so the
//                                         client only needs that address (claude mcp add --transport http apk-lab <url>). --host 127.0.0.1 by default; --host 0.0.0.0 (or a
//                                         local IP) also accepts MCP clients from other machines of the network: the token in the address is then the only protection and the
//                                         traffic is plain HTTP, so use it on networks you trust. The page always reaches the bridge on this machine (127.0.0.1).
//   node lab-mcp.mjs token                prints the token of ~/.apk-web-lab-mcp-token (only used when neither --token nor APK_WEB_LAB_MCP_TOKEN is given)
//   options: --port 8790  --origin <lab origin> (repeatable)  --token <token>  --timeout-ms 60000
//
// Every tool call is answered by the page, with what the page shows at that moment; the bridge stores nothing. One tool also reads a file here: install_apk takes the path of an
// .apk on this machine, and the page fetches its bytes from this bridge (GET /<token>/file/<id>, same origin and token checks, only while that call is in flight). The adb tool
// does the same for the local files its command line names: read for `adb install <apk>` and `adb push <local> …`, written for `adb pull … [local]`, `> file` and the video of record_screen (the page posts
// the bytes to POST /<token>/file/<id>). Only paths written in the MCP client's own command, only for the length of the call. Safety: it listens on 127.0.0.1 only; the page's requests must come
// from one of the allowed origins (the public lab and a local copy by default: another site open in the same browser is refused by its Origin) and carry the pairing token. The
// token is always required: the page generates it (shown in its MCP JSON) and the client passes it in APK_WEB_LAB_MCP_TOKEN (or --token); without either, the token kept in
// ~/.apk-web-lab-mcp-token (created once, readable only by you) is used, as before. Tokens are compared in constant time and never logged. Node.js built-ins only. Protocol logs
// go to stderr; stdout carries MCP messages only.
import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 8790;
export const DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'apk-web-lab', title: 'APK Web Lab (página aberta no navegador)', version: '1.3.0' };
const MAX_RESULT_BYTES = 24 * 1024 * 1024;
export const MAX_APK_BYTES = 1024 * 1024 * 1024;   // the lab's own limit for an APK (src/app.js)
const LONG_CALL_MS = 300000;   // reading, loading and starting an app can take minutes for a large APK

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = description => ({ type: 'string', description }), num = description => ({ type: 'number', description }), bool = description => ({ type: 'boolean', description });
/** The tools; the page (src/mcp-tools.js) answers each one by name. */
export const TOOLS = [
  { name: 'lab_status', description: 'O que a página do lab mostra agora: APK carregado, Activity, janelas, "Tela pronta" e o motivo de não estar pronta, plugins rodando.', inputSchema: obj() },
  { name: 'screenshot', description: 'Imagem da tela do app, ou de um componente: pela chave de layout_bounds (element_key), por testTag, por um texto visível, ou por um retângulo (bounds, coordenadas da janela). Opcional: esperar a tela pronta antes.',
    inputSchema: obj({ element_key: str('chave de um elemento de layout_bounds'), test_tag: str('testTag do componente Compose'), text: str('texto visível do componente (o primeiro que contém)'),
      bounds: obj({ left: num(''), top: num(''), right: num(''), bottom: num('') }, ['left', 'top', 'right', 'bottom']), max_width: num('largura máxima da imagem em px (padrão 1080)'), wait_ready: bool('esperar a "Tela pronta" antes (padrão false)') }) },
  { name: 'layout_bounds', description: 'As caixas de "Mostrar limites de layout": cada componente (Compose e Views) com chave, nome, limites na janela, textos, testTag, papel e ações.', inputSchema: obj({ names: bool('nomear pelos composables (padrão true)') }) },
  { name: 'compose_tree', description: 'A árvore de layout do Compose: cada nó com id, handle, pai, nome, limites, modificadores e semântica (textos, testTag, ações).', inputSchema: obj({ max_nodes: num('máximo de nós (padrão 600)'), locals: { type: 'array', items: { type: 'string' }, description: 'CompositionLocals a anexar a cada nó (nome ou parte): node.locals.LocalX é o valor naquele composable' } }) },
  { name: 'composition_locals', description: 'Os CompositionLocals de um componente do Compose (o que LocalX.current vale ali). handle vem de compose_tree.', inputSchema: obj({ handle: str('handle do nó (compose_tree)'), only: { type: 'array', items: { type: 'string' }, description: 'nomes ou partes de nomes' } }, ['handle']) },
  { name: 'find_composition_local', description: 'Onde um CompositionLocal é fornecido na tela, agrupado por valor, com um componente que vê cada valor.', inputSchema: obj({ match: str('nome do Local, parte dele ou a classe do valor') }, ['match']) },
  { name: 'view_models', description: 'Os ViewModels da tela (Activity, fragments, destinos de navegação) com handle e classe.', inputSchema: obj() },
  { name: 'inspect', description: 'Os campos de um objeto da VM em JSON (somente leitura).', inputSchema: obj({ handle: str('handle'), depth: num('profundidade (padrão 2)') }, ['handle']) },
  { name: 'field', description: 'Um valor por caminho a partir de um objeto: "estado.value.itens.0.titulo" (um array de partes para chaves com pontos).', inputSchema: obj({ handle: str('handle'), path: { type: ['string', 'array'], items: { type: 'string' } }, depth: num('profundidade (padrão 1)') }, ['handle', 'path']) },
  { name: 'statics', description: 'Os campos estáticos de uma classe que o app já inicializou (object Kotlin, companion, singleton, contêiner de injeção).', inputSchema: obj({ class_name: str('nome da classe') }, ['class_name']) },
  { name: 'static_field', description: 'Um valor por caminho a partir de um campo estático.', inputSchema: obj({ class_name: str('nome da classe'), path: { type: ['string', 'array'], items: { type: 'string' } } }, ['class_name', 'path']) },
  { name: 'methods', description: 'Os métodos de um objeto (pelo handle) ou de uma classe, com assinatura, parâmetros e retorno, lidos do DEX (nada roda). Para escolher o que chamar com invoke_method.',
    inputSchema: obj({ handle: str('handle de um objeto (view_models, instances, field)'), class_name: str('ou o nome de uma classe'), match: str('parte do nome ou /regex/'), parameters: num('só os com este número de parâmetros'), static: bool('só estáticos (true) ou só de instância (false)') }) },
  { name: 'invoke_method', description: 'Chama um método do app na thread principal da VM, como uma operação do lab (igual a um clique): o que ele agenda roda e a tela atualiza. Devolve o valor de retorno em JSON; uma exceção Java volta como erro com o tipo e a mensagem.',
    inputSchema: obj({ handle: str('handle do objeto (método de instância)'), class_name: str('ou a classe (método estático)'), method: str('nome do método'), args: { type: 'array', description: 'argumentos em JSON, na ordem; um objeto vai pelo handle' }, signature: str('assinatura JVM quando há sobrecarga, ex. (ILjava/lang/String;)V') }, ['method']) },
  { name: 'classes', description: 'Classes do APK cujo nome contém o texto (ou casam com /regex/).', inputSchema: obj({ match: str('parte do nome'), initialized: bool('só as já inicializadas') }, ['match']) },
  { name: 'instances', description: 'Os objetos vivos de uma classe (subclasses incluídas), com handles.', inputSchema: obj({ class_name: str('nome da classe'), limit: num('máximo (padrão 20)') }, ['class_name']) },
  { name: 'referrers', description: 'Quem segura um objeto: campos estáticos e objetos (com o campo).', inputSchema: obj({ handle: str('handle') }, ['handle']) },
  { name: 'plugins', description: 'Os plugins da página e a saída de cada um (textos, tabelas, JSON e imagens dos blocos), estado e erros.', inputSchema: obj({ id: str('só este plugin (id ou nome)'), include_images: bool('incluir as imagens dos blocos (padrão true)') }) },
  { name: 'click_plugin_button', description: 'Clica num botão de um plugin (lab.button), como o usuário: o código do plugin roda e a resposta vem quando terminou (ok, tempo, erros novos). plugins lista os botões de cada plugin.',
    inputSchema: obj({ plugin: str('id ou nome do plugin'), button: str('id do botão (ou o texto dele)'), wait_ms: num('esperar o código terminar até (padrão 10000)') }, ['plugin', 'button']) },
  { name: 'logcat', description: 'Linhas do Logcat do app (coletadas enquanto o MCP está conectado). Para acompanhar: passe since = o "next" da resposta anterior (só linhas novas) e wait_ms para esperar até elas chegarem.',
    inputSchema: obj({ level: str('nível mínimo: V, D, I, W ou E'), contains: str('texto na tag ou na mensagem'), limit: num('máximo de linhas, as mais recentes (padrão 200)'), since: num('só o que veio depois deste cursor (o "next" da resposta anterior)'), start: str('"now": não devolve nada, só o cursor para acompanhar a partir de agora'), from_time: str('a partir deste momento (ISO 8601 ou milissegundos), relógio do aparelho'), last_seconds: num('só os últimos N segundos'), wait_ms: num('esperar até N ms por algo novo (máx. 30000)') }) },
  { name: 'network', description: 'O log de rede do app: método, URL, status, tempo, mock ou redirecionamento; com include_body, o corpo da resposta (texto). Para acompanhar: since e wait_ms, como no logcat.',
    inputSchema: obj({ contains: str('texto na URL ou no método'), limit: num('máximo, as mais recentes (padrão 50)'), since: num('só o que veio depois deste cursor (o "next" da resposta anterior)'), start: str('"now": não devolve nada, só o cursor para acompanhar a partir de agora'), from_time: str('a partir deste momento (ISO 8601 ou milissegundos), relógio do aparelho'), last_seconds: num('só os últimos N segundos'), wait_ms: num('esperar até N ms por algo novo (máx. 30000)'), include_body: bool('incluir o corpo da resposta (texto, até 20 KB) e os cabeçalhos') }) },
  { name: 'set_mock', description: 'Cria ou troca (mesmo id) um mock de endpoint: as requisições do app que casarem com método e URL recebem esta resposta sem ir à rede. Fica em Controles › Mock de endpoints do pacote aberto. Depois, use reload para o app buscar de novo.',
    inputSchema: obj({ url: str('URL ou padrão (https://api.exemplo.com/v1/perfil, *.exemplo.com/v1/*)'), method: str('GET, POST, ... ou ANY (padrão)'), status: num('status HTTP (padrão 200)'), body: { description: 'corpo da resposta: texto, ou um objeto (vira JSON)' }, headers: { type: 'object', description: 'cabeçalhos da resposta, { "Content-Type": "application/json" }' }, delay_ms: num('atraso da resposta'), id: str('id para trocar o mesmo mock depois'), name: str('nome que aparece na lista'), query: str('"ignore" (padrão) ou "exact"') }, ['url']) },
  { name: 'remove_mock', description: 'Remove um mock pelo id (de set_mock ou list_mocks).', inputSchema: obj({ id: str('id do mock') }, ['id']) },
  { name: 'list_mocks', description: 'Os mocks do pacote aberto, com quantas vezes cada um respondeu.', inputSchema: obj() },
  { name: 'tap', description: 'Toca num componente (testTag, texto ou chave de layout_bounds) ou num ponto (x, y da janela): em Compose é um toque real, numa View é o clique. Espera a tela assentar e devolve a tela (e o print, se pedido).',
    inputSchema: obj({ test_tag: str('testTag do componente'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), x: num('x na janela'), y: num('y na janela'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'type', description: 'Escreve num campo de texto (troca o texto inteiro): em Compose, foca o campo, seleciona tudo e digita caractere por caractere pelo InputConnection, como o teclado do Android (máscaras e filtros do app agem como no aparelho; sem InputConnection, SetText e o resultado diz isso); numa View, o campo.',
    inputSchema: obj({ value: str('o texto'), test_tag: str('testTag do componente'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }, ['value']) },
  { name: 'scroll', description: 'Rola a lista que contém o componente (ou a maior lista da tela, sem alvo): dy positivo desce, dx positivo vai para a direita.',
    inputSchema: obj({ dy: num('quanto rolar na vertical, em px (padrão 400)'), dx: num('na horizontal'), test_tag: str('testTag do componente'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), x: num('x de um ponto dentro da lista'), y: num('y'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'scroll_to', description: 'Rola uma lista (ou outro componente rolável) até uma posição em px (1 px = 1 dp no lab) ou até uma porcentagem (0 a 100) do curso da rolagem, na vertical e/ou na horizontal, pela rolagem do próprio app (ScrollBy do Compose, View.scrollBy), repetindo até chegar. Sem alvo, a maior lista da tela. Devolve a posição, o curso (maxX/maxY) e a porcentagem em que parou; numa lista preguiçosa os números são a estimativa da própria lista (estimated: true).',
    inputSchema: obj({ to_y: num('posição vertical em px, a partir do início'), to_x: num('posição horizontal em px'), percent_y: num('porcentagem vertical do curso, 0 a 100'), percent_x: num('porcentagem horizontal, 0 a 100'), test_tag: str('testTag do componente rolável ou de algo dentro dele'), text: str('texto visível do componente (o primeiro que contém)'), element_key: str('chave de layout_bounds'), x: num('x de um ponto dentro da lista'), y: num('y'), wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'scroll_info', description: 'Onde uma lista (ou outro componente rolável) está, sem mover: posição x/y e curso maxX/maxY em px, e a porcentagem. Mesmo alvo de scroll_to.',
    inputSchema: obj({ test_tag: str('testTag do componente rolável ou de algo dentro dele'), text: str('texto visível do componente'), element_key: str('chave de layout_bounds'), x: num('x de um ponto dentro da lista'), y: num('y') }) },
  { name: 'back', description: 'Volta para a tela anterior (o botão Voltar do aparelho).', inputSchema: obj({ wait_ms: num('esperar a tela assentar depois (padrão 2000)'), screenshot: bool('devolver o print da tela depois') }) },
  { name: 'reload', description: 'Recarrega a tela atual: recreate (padrão, mantém estado salvo e ViewModels) ou reopen (instância nova com o mesmo Intent).', inputSchema: obj({ mode: str('"recreate" ou "reopen"') }) },
  { name: 'wait_ready', description: 'Espera a "Tela pronta" (Activity e fragments carregados, nada pendente por 300 ms) e devolve a tela. Uma requisição de rede lenta ou pendurada não segura a espera até o fim: com a tela já desenhada e parada e só a rede em andamento, a espera dá mais network_ms e devolve ready: false com networkPending (método, URL e há quantos segundos cada requisição está aberta).', inputSchema: obj({ timeout_ms: num('tempo máximo (padrão 15000)'), network_ms: num('com a tela parada e só rede em andamento, quanto mais esperar por ela (padrão 5000; 0 não espera)') }) },
  { name: 'record_screen', description: 'Grava a tela do app em vídeo. action "start" começa a gravar; enquanto grava, use as outras ferramentas (tap, type, scroll, adb …); action "stop" encerra e grava o arquivo em path, na máquina onde a ponte roda (sem path: gravacao-tela-<data e hora>.mp4 ou .webm na pasta da ponte); "status" diz se está gravando; "discard" joga fora um vídeo já encerrado. A gravação para sozinha em max_seconds e o vídeo fica guardado na página até o stop. O formato é mp4 quando o navegador grava mp4, senão webm (format escolhe); o path precisa terminar na extensão do formato, que start devolve. Grava o que um screenshot mostra (Compose e Views com raster); uma tela só de Views desenhadas pelo DOM da página não tem imagem e start diz isso. Mantenha a aba do lab visível: em segundo plano o navegador reduz os quadros.',
    inputSchema: obj({ action: str('start | stop | status | discard'), path: str('stop: arquivo de vídeo a gravar na máquina da ponte (.mp4 ou .webm), ou uma pasta'), fps: num('start: quadros por segundo, 1 a 30 (padrão 12)'), max_width: num('start: largura máxima do vídeo em px (padrão 1080; a tela tem 1 px por dp)'), max_seconds: num('start: duração máxima, 1 a 300 s (padrão 60)'), format: str('start: "mp4" ou "webm" (padrão: mp4 se o navegador grava, senão webm)') }, ['action']) },
  // the Controles panel
  { name: 'app_data', description: 'Dados do app (Controles › Dados do app): sem argumentos, cada SharedPreferences com as chaves (tipo e valor) e cada banco SQLite com tabelas, colunas e contagem de linhas. prefs: um arquivo de SharedPreferences. db + table: uma página de linhas (rowid primeiro; offset, limit até 500).', inputSchema: obj({ prefs: str('nome do arquivo de SharedPreferences (sem .xml)'), db: str('nome do banco em databases/'), table: str('tabela ou visão'), offset: num('primeira linha (0)'), limit: num('linhas (100, até 500)') }) },
  { name: 'set_preferences', description: 'Muda SharedPreferences pelo Editor do próprio app (putX ou remove, depois commit()): o app vê na próxima leitura e os listeners dele são avisados. changes: [{ key, type: string|int|long|float|boolean|set, value }] ou [{ key, remove: true }]; set é uma lista de textos.', inputSchema: obj({ name: str('arquivo de SharedPreferences (sem .xml); pode ser novo'), changes: { type: 'array', items: { type: 'object' }, description: 'as mudanças, em ordem' } }, ['name', 'changes']) },
  { name: 'edit_row', description: 'Muda uma linha de uma tabela SQLite do app por uma segunda conexão ao banco: set (colunas novas) ou remove numa linha dada por rowid (ou key = chave primária de uma tabela WITHOUT ROWID), ou insert (uma linha nova). Valores por parâmetro, nunca colados no SQL.', inputSchema: obj({ db: str('banco'), table: str('tabela'), rowid: num('rowid da linha'), key: { type: 'object', description: 'chave primária { coluna: valor } (tabela sem rowid)' }, set: { type: 'object', description: '{ coluna: valor }' }, insert: { type: 'object', description: '{ coluna: valor } da linha nova' }, remove: bool('apaga a linha') }, ['db', 'table']) },
  { name: 'sql', description: 'Um comando SQL num banco do app (segunda conexão, como o sqlite3 do adb): uma consulta devolve colunas e linhas (até limit), uma mudança devolve quantas linhas mudou. params: os valores dos ?.', inputSchema: obj({ db: str('banco'), sql: str('um comando SQL'), params: { type: 'array', description: 'valores dos ?' }, limit: num('linhas (200, até 500)') }, ['db', 'sql']) },
  { name: 'device', description: 'Os ajustes do dispositivo (Controles › Aparência, Dispositivo, Execução): sem set, os atuais e as opções; set muda e aplica na hora, como o painel (connectivity online|metered|offline desliga a internet; language (en, pt, es …) e region (qualquer país ISO, ex. BR, PT, US) formam o locale, ou locale direto como pt-BR; darkTheme; orientation portrait|landscape; fontScale; animatorScale; hour24; timeZone; battery { level, charging }; screen; navigation gesture|buttons; renderer gpu|cpu e engine wasm|js valem no próximo lançamento).', inputSchema: obj({ set: { type: 'object', description: 'ajustes a mudar' } }) },
  { name: 'apps', description: 'Os apps instalados na tela inicial do emulador (id, pacote, rótulo, arquivo, qual é o atual e se está aberto): action list (padrão). Também restart (reabre o APK atual e inicia de novo) e stop (encerra a VM); open é o mesmo que open_app. Para instalar, abrir e fechar: install_apk, open_app e close_app.', inputSchema: obj({ action: str('list | open | restart | stop'), id: str('id do app instalado (de list)'), wait_ms: num('espera da tela pronta depois de open/restart (15000)') }) },
  { name: 'adb', description: 'Roda uma linha de comando do adb contra o aparelho do lab (a página aberta), para reaproveitar os comandos de um emulador: adb install app.apk, adb shell am start -n pacote/.Main, adb shell input tap 200 400, adb shell input text olá, adb logcat -d *:E, adb exec-out screencap -p > tela.png, adb shell uiautomator dump /dev/tty, adb shell pm grant pacote android.permission.CAMERA, adb shell settings put global animator_duration_scale 0, adb shell dumpsys window | grep mCurrentFocus. Aceita aspas, | grep/head/tail/wc/sort/uniq, && || ; e > arquivo (gravado na máquina da ponte). Cada comando usa o caminho da própria página (instalar como arquivo solto, o ícone, Intents resolvidos pelo manifesto, toque real, teclado, ajustes de Controles). Não é o adb: o que a página não alcança (am broadcast, serviços, teclas fora de um campo de texto, arquivos privados do app, forward/reverse) falha com o nome do comando e status 127, nunca roda como outra coisa. "adb help" lista tudo. Devolve a saída do comando, a imagem (screencap) e, quando há, o status e notas do lab sobre como o comando foi atendido. 1 px = 1 dp (160 dpi).',
    inputSchema: obj({ command: str('a linha de comando, como num terminal, ex. "adb shell input tap 200 400" (o "adb" inicial é opcional)'), args: { type: 'array', items: { type: 'string' }, description: 'ou as palavras de um único comando adb, já separadas, ex. ["shell", "input", "text", "olá mundo"]' } }) },
  { name: 'install_apk', description: 'Instala um APK na tela inicial do emulador, como soltar o arquivo na página: path é um arquivo .apk na máquina onde a ponte lab-mcp roda (a ponte entrega os bytes à página aberta no navegador; nada vai para a rede). O aparelho roda um app por vez: instalar encerra o app que estiver aberto. Com open: true o app é aberto em seguida e a resposta espera a tela pronta. Devolve o id do app (o de open_app e close_app), o pacote e a Activity inicial; um APK que o lab não consegue ler volta como erro com o motivo.',
    inputSchema: obj({ path: str('caminho do arquivo .apk: absoluto, relativo à pasta onde a ponte foi iniciada, ou ~/…'), open: bool('abrir depois de instalar (padrão false)'), wait_ms: num('com open: espera da tela pronta (padrão 15000)'), network_ms: num('com open: com a tela parada e só rede em andamento, quanto mais esperar (padrão 5000)') }, ['path']) },
  { name: 'open_app', description: 'Abre um app já instalado, como tocar no ícone dele na tela inicial: id (de apps ou install_apk), package ou name (o rótulo ou o nome do arquivo). Sem nenhum dos três, o app atual (o último instalado ou aberto). Se ele já está aberto, volta à frente (alreadyOpen); outro app que esteja aberto é encerrado antes (um por vez). Espera a tela pronta; se o app parou ao abrir, a resposta traz o erro.',
    inputSchema: obj({ id: str('id do app instalado (de apps ou install_apk)'), package: str('ou o pacote, ex. com.exemplo.app'), name: str('ou o rótulo do app ou o nome do arquivo .apk'), wait_ms: num('espera da tela pronta (padrão 15000)'), network_ms: num('com a tela parada e só rede em andamento, quanto mais esperar (padrão 5000)') }) },
  { name: 'close_app', description: 'Fecha o app aberto, como jogá-lo para fora dos recentes: o processo dele termina, o ícone continua na tela inicial e open_app abre de novo numa VM nova. Com id, package ou name, só fecha se esse for o app aberto. Sem app aberto (ou outro app aberto), responde closed: false e diz o que está aberto.',
    inputSchema: obj({ id: str('id do app instalado (de apps ou install_apk)'), package: str('ou o pacote'), name: str('ou o rótulo do app ou o nome do arquivo .apk') }) },
  { name: 'open_link', description: 'Abre um deep link / Intent no app, como Controles › Abrir link: resolvido pelos filtros do manifesto e iniciado como am start.', inputSchema: obj({ link: str('a URI, ex. https://… ou meuapp://…'), action: str('ação do Intent (padrão VIEW)'), component: str('Activity explícita, opcional') }) },
  { name: 'host_redirects', description: 'As regras de Redirecionar hosts (o app pede um host, o lab atende de outro, ex. um servidor local): sem rules, as atuais; rules troca todas: [{ from: "api.exemplo.com", to: "localhost:8080", enabled: true }].', inputSchema: obj({ rules: { type: 'array', items: { type: 'object' }, description: 'as regras novas (troca todas)' } }) },
  { name: 'permissions', description: 'As permissões de execução do app (Controles › Permissões): sem name, a lista com estado (ask|allow|deny) e se está concedida; name + state muda uma (vale na próxima checkSelfPermission).', inputSchema: obj({ name: str('ex. CAMERA ou android.permission.CAMERA'), state: str('ask | allow | deny') }) },
];

export const TOKEN_ENV = 'APK_WEB_LAB_MCP_TOKEN';
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
/** Constant-time token check (both sides hashed first, so lengths do not leak either). */
export function tokenMatches(given, expected) {
  const digest = value => createHash('sha256').update(String(value ?? '')).digest();
  return typeof given === 'string' && typeof expected === 'string' && expected.length > 0 && timingSafeEqual(digest(given), digest(expected));
}
/** Which token the bridge uses: --token, then APK_WEB_LAB_MCP_TOKEN, then ~/.apk-web-lab-mcp-token. -> { token, source } or { error } (never contains the token). */
export function resolveToken({ argToken = null, env = {}, file = tokenFile(), readFile = readOrCreateToken } = {}) {
  const pick = (value, source) => TOKEN_PATTERN.test(value) ? { token: value, source } : { error: `token inválido em ${source}: use o token que a página mostra em Controles › MCP (16 ou mais letras, números, _ ou -)` };
  if (argToken != null) return pick(String(argToken).trim(), '--token');
  const fromEnv = env[TOKEN_ENV]; if (fromEnv != null && String(fromEnv).trim() !== '') return pick(String(fromEnv).trim(), TOKEN_ENV);
  return { token: readFile(file), source: file };
}

export function tokenFile() { return path.join(homedir(), '.apk-web-lab-mcp-token'); }
export function readOrCreateToken(file = tokenFile()) {
  try { const text = readFileSync(file, 'utf8').trim(); if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return text; } catch { /* created below */ }
  const token = randomBytes(18).toString('base64url'); writeFileSync(file, token + '\n', { mode: 0o600 }); return token;
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
export function createBridge({ port = DEFAULT_PORT, host = '127.0.0.1', origins = DEFAULT_ORIGINS, token, timeoutMs = 60000, log = message => process.stderr.write(`[lab-mcp] ${message}\n`) } = {}) {
  if (!TOKEN_PATTERN.test(String(token ?? ''))) throw new Error('lab-mcp: a ponte precisa de um token (16 ou mais letras, números, _ ou -)');
  const allowed = new Set(origins), pending = new Map(), files = new Map(), uploads = new Map(); let page = null, nextId = 1, server = null, refused = null, refusedLogged = 0;
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const send = (res, status, body, origin) => { if (origin) cors(origin, res); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  /** MCP over HTTP (Streamable HTTP, JSON responses only): POST /mcp/<token> with one JSON-RPC message or a batch. A browser page of another site is refused by its Origin;
   *  clients that are not browsers send none, and the token in the address (or Authorization: Bearer) is what admits them. */
  function onMcp(req, res, url, origin) {
    const plain = (status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body === null ? '' : JSON.stringify(body)); };
    if (origin && !allowed.has(origin)) { plain(403, { error: `origem não permitida: ${origin}` }); return; }
    if (origin) cors(origin, res);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type, authorization, mcp-protocol-version' }); res.end(); return; }
    let given = ''; try { given = decodeURIComponent(url.pathname.split('/')[2] ?? ''); } catch { /* refused below */ }
    if (!given) given = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? '';
    // 403, never 401: to an MCP client a 401 means "log in with OAuth" (MCP authorization), and clients such as Cursor then start an OAuth flow this bridge does not have and
    // wait there. The token is in the address: a wrong or missing one is simply refused, with the reason.
    if (!tokenMatches(given, token)) { plain(403, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'token recusado: use o endereço que a ponte mostrou ao iniciar (…/mcp/<token>), com o token da página (Controles › MCP)' } }); return; }
    if (req.method !== 'POST') { plain(405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method Not Allowed: esta ponte responde a POST (sem fluxo iniciado pelo servidor)' } }, { allow: 'POST' }); return; }
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
    if (url.pathname.startsWith('/.well-known/')) { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: 'esta ponte não usa OAuth: o token vai no endereço (…/mcp/<token>)' })); return; }
    if (!origin || !allowed.has(origin)) { send(res, 403, { error: `origem não permitida: ${origin ?? '(nenhuma)'}; rode com --origin ${origin ?? '<origem do lab>'}` }); return; }
    if (req.method === 'OPTIONS') {
      cors(origin, res, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.writeHead(204); res.end(); return;
    }
    const [, key, action] = url.pathname.split('/');
    let given = ''; try { given = decodeURIComponent(key ?? ''); } catch { /* malformed: refused below */ }
    if (!tokenMatches(given, token)) {
      refused = { at: Date.now(), origin };
      if (Date.now() - refusedLogged > 5000) { refusedLogged = Date.now(); log(`página recusada (${origin}): o token dela é diferente do desta ponte. Pare a ponte e rode de novo o comando de Controles › MCP (ou copie de novo a configuração, se o cliente MCP inicia a ponte).`); }
      send(res, 401, { error: 'token recusado: o token desta página é diferente do configurado na ponte. Pare a ponte e rode de novo o comando de Controles › MCP (ou copie de novo a configuração, se o cliente MCP inicia a ponte).', code: 'bad-token' }, origin); return;
    }
    if (req.method === 'GET' && action === 'events') {
      cors(origin, res); res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      if (page) { page.res.write('event: replaced\ndata: {}\n\n'); page.res.end(); }
      const current = { res, origin, since: Date.now() }; page = current;
      res.write(`event: hello\ndata: ${JSON.stringify({ server: SERVER_INFO, tools: TOOLS.map(tool => tool.name) })}\n\n`);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(keepAlive); if (page === current) { page = null; log('página desconectada'); } });
      log(`página conectada (${origin})`); return;
    }
    if (req.method === 'POST' && action === 'result') {
      let size = 0; const chunks = [];
      req.on('data', chunk => { size += chunk.length; if (size > MAX_RESULT_BYTES) { req.destroy(); return; } chunks.push(chunk); });
      req.on('end', () => {
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { send(res, 400, { error: 'JSON inválido' }, origin); return; }
        const waiter = pending.get(body?.id); if (!waiter) { send(res, 404, { error: 'chamada desconhecida ou já expirada' }, origin); return; }
        pending.delete(body.id); clearTimeout(waiter.timer); waiter.resolve(body); send(res, 200, { ok: true }, origin);
      });
      return;
    }
    if (req.method === 'GET' && action === 'file') {   // the APK of an install_apk call in flight, streamed from disk to the page (nothing is kept here)
      const entry = files.get(url.pathname.split('/')[3] ?? ''); if (!entry) { send(res, 404, { error: 'arquivo desconhecido: a chamada install_apk dele já terminou' }, origin); return; }
      cors(origin, res); res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(entry.size), 'cache-control': 'no-store' });
      const stream = createReadStream(entry.file, { start: 0, end: entry.size - 1 }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
    }
    if (req.method === 'POST' && action === 'file') {   // the bytes of a file an adb call in flight writes on this machine (adb pull, `> file`), streamed to disk
      const slot = uploads.get(url.pathname.split('/')[3] ?? ''); if (!slot) { send(res, 404, { error: 'arquivo de saída desconhecido: a chamada dele já terminou' }, origin); return; }
      if (slot.exts && !slot.named) { const ext = url.searchParams.get('ext') ?? ''; if (!slot.exts.includes(ext)) { send(res, 400, { error: `extensão não aceita para este arquivo (${slot.exts.join(', ')})` }, origin); return; } slot.dest += `.${ext}`; slot.named = true; }   // a file the bridge named without its extension: the page says which of the allowed ones it is
      const out = createWriteStream(slot.dest, { flags: slot.append ? 'a' : 'w' }); let bytes = 0, failed = false;
      const fail = (status, message) => { if (failed) return; failed = true; out.destroy(); slot.error = message; send(res, status, { error: message }, origin); };
      out.on('error', error => fail(500, `não foi possível gravar ${slot.dest}: ${error.code ?? error.message}`));
      req.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_APK_BYTES) { fail(413, 'arquivo maior que 1 GiB'); req.destroy(); return; } if (!failed) out.write(chunk); });
      req.on('end', () => { if (failed) return; out.end(() => { if (failed) return; slot.bytes = (slot.bytes ?? 0) + bytes; slot.written = true; send(res, 200, { ok: true, bytes }, origin); }); });
      return;
    }
    if (req.method === 'GET' && action === 'hello') { send(res, 200, { server: SERVER_INFO, connected: !!page }, origin); return; }
    send(res, 404, { error: 'não encontrado' }, origin);
  }
  /** Sends one tool call to the page; resolves with { content, isError }. */
  function callPage(name, args) {
    if (!page) {
      const mismatch = refused && Date.now() - refused.at < 10 * 60 * 1000 ? ` Uma página (${refused.origin}) tentou conectar há ${Math.round((Date.now() - refused.at) / 1000)} s com outro token e foi recusada: rode de novo o comando de Controles › MCP (o token mudou?) para a configuração do cliente MCP e reinicie o servidor MCP.` : '';
      return Promise.resolve({ isError: true, content: [{ type: 'text', text: `A página do APK Web Lab não está conectada. Abra o lab no navegador, carregue o APK e em Controles › MCP clique em Conectar.${mismatch}` }] });
    }
    const long = name === 'install_apk' || name === 'open_app' || name === 'adb' || (name === 'apps' && (args?.action === 'open' || args?.action === 'restart'));
    const id = nextId++, wait = name === 'wait_ready' ? Math.max(timeoutMs, Number(args?.timeout_ms ?? 15000) + 5000) : long ? Math.max(timeoutMs, LONG_CALL_MS + (Number(args?.wait_ms) || 15000)) : timeoutMs;
    return new Promise(resolve => {
      const timer = setTimeout(() => { pending.delete(id); resolve({ isError: true, content: [{ type: 'text', text: `A página não respondeu em ${Math.round(wait / 1000)} s (aba em segundo plano ou ocupada?).` }] }); }, wait);
      pending.set(id, { resolve: body => resolve(body.ok === false ? { isError: true, content: [{ type: 'text', text: String(body.error ?? 'falha na página') }] } : { content: Array.isArray(body.content) ? body.content : [{ type: 'text', text: JSON.stringify(body.content ?? null) }], isError: !!body.isError }), timer });
      page.res.write(`event: call\ndata: ${JSON.stringify({ id, tool: name, args: args ?? {} })}\n\n`);
    });
  }
  /** install_apk: the .apk named by `path` is checked here and offered to the page for the length of the call; the page gets its name and size, never the path. */
  async function installApk(args) {
    const refuse = message => ({ isError: true, content: [{ type: 'text', text: message }] });
    const given = typeof args?.path === 'string' ? args.path.trim() : '';
    if (!given) return refuse('install_apk: path é obrigatório (o caminho de um arquivo .apk na máquina onde a ponte lab-mcp roda).');
    const file = path.resolve(given === '~' || given.startsWith('~/') ? path.join(homedir(), given.slice(1)) : given);
    if (!/\.apk$/i.test(file)) return refuse(`install_apk: ${path.basename(file)} não é um arquivo .apk.`);
    let info; try { info = await stat(file); } catch (error) { return refuse(`install_apk: não foi possível ler ${file} (${error?.code ?? error?.message ?? error}). O caminho é da máquina onde a ponte lab-mcp roda.`); }
    if (!info.isFile()) return refuse(`install_apk: ${file} não é um arquivo.`);
    if (info.size === 0) return refuse(`install_apk: ${file} está vazio.`);
    if (info.size > MAX_APK_BYTES) return refuse(`install_apk: ${path.basename(file)} tem ${Math.round(info.size / 1048576)} MiB; o limite do lab é 1 GiB por APK.`);
    if (!page) return callPage('install_apk', {});   // says that the page is not connected
    const id = randomBytes(16).toString('hex'), { path: _path, ...rest } = args;
    files.set(id, { file, size: info.size });
    try { return await callPage('install_apk', { ...rest, file: { id, name: path.basename(file), size: info.size } }); } finally { files.delete(id); }
  }
  /** adb: the local files the command line names are offered to the page (read: install, push) or opened for it to write (pull, > file) for the length of the call. */
  async function adbCall(args) {
    if (!page) return callPage('adb', {});   // says that the page is not connected
    const named = adbLocalFiles(args ?? {}), local = { files: {}, missing: {}, outputs: {} }, ids = [], slots = [];
    const absolute = given => path.resolve(given === '~' || given.startsWith('~/') ? path.join(homedir(), given.slice(1)) : given);
    for (const given of named.reads) {
      const file = absolute(given); let info; try { info = await stat(file); } catch (error) { local.missing[given] = error?.code === 'ENOENT' ? 'No such file or directory (na máquina onde a ponte lab-mcp roda)' : String(error?.code ?? error?.message ?? error); continue; }
      if (!info.isFile()) { local.missing[given] = 'não é um arquivo'; continue; }
      if (info.size > MAX_APK_BYTES) { local.missing[given] = 'maior que 1 GiB'; continue; }
      const id = randomBytes(16).toString('hex'); files.set(id, { file, size: info.size }); ids.push(id); local.files[given] = { id, name: path.basename(file), size: info.size };
    }
    for (const output of named.writes) {
      let dest = absolute(output.path);
      try { if ((await stat(dest)).isDirectory()) { if (!output.remote) { local.missing[output.key] = 'é uma pasta'; continue; } dest = path.join(dest, path.basename(output.remote)); } } catch { /* a new file */ }
      try { if (!(await stat(path.dirname(dest))).isDirectory()) throw new Error('not a directory'); } catch { local.missing[output.key] = `a pasta ${path.dirname(dest)} não existe na máquina onde a ponte lab-mcp roda`; continue; }
      const id = randomBytes(16).toString('hex'), slot = { dest, append: !!output.append }; uploads.set(id, slot); slots.push(slot); ids.push(id); local.outputs[output.key] = { id };
    }
    try {
      const result = await callPage('adb', { ...(typeof args?.command === 'string' ? { command: args.command } : {}), ...(Array.isArray(args?.args) ? { args: args.args } : {}), local });
      const written = slots.filter(slot => slot.written).map(slot => `arquivo gravado nesta máquina: ${slot.dest} (${slot.bytes} bytes)`);
      return written.length ? { ...result, content: [...result.content, { type: 'text', text: written.join('\n') }] } : result;
    } finally { for (const id of ids) { files.delete(id); uploads.delete(id); } }
  }
  /** record_screen stop: the video file is opened here for the page to write, at `path` (a .mp4 / .webm file, or a folder) or under a dated name in the folder the bridge runs in. */
  async function recordCall(args) {
    if (args?.action !== 'stop' || !page) return callPage('record_screen', args ?? {});
    const local = { outputs: {}, missing: {} }, two = value => String(value).padStart(2, '0'), date = new Date(), stamp = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`, auto = `gravacao-tela-${stamp}`, formats = ['mp4', 'webm'];
    const given = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : null; let dest = path.resolve(given === null ? auto : given === '~' || given.startsWith('~/') ? path.join(homedir(), given.slice(1)) : given), exts = given === null ? formats : null;
    try { if (given !== null && (await stat(dest)).isDirectory()) { dest = path.join(dest, auto); exts = formats; } } catch { /* a new file */ }
    const ext = exts ? null : path.extname(dest).slice(1).toLowerCase(); let id = null, slot = null;
    if (!exts && !formats.includes(ext)) local.missing.recording = `path precisa terminar em .mp4 ou .webm (ou ser uma pasta): ${given}`;
    else { try { if (!(await stat(path.dirname(dest))).isDirectory()) throw new Error('not a directory'); id = randomBytes(16).toString('hex'); slot = { dest, append: false, exts }; uploads.set(id, slot); local.outputs.recording = { id, ext }; } catch { local.missing.recording = `a pasta ${path.dirname(dest)} não existe na máquina onde a ponte lab-mcp roda`; } }
    try {
      const { path: _path, ...rest } = args, result = await callPage('record_screen', { ...rest, local });
      return slot?.written ? { ...result, content: [...result.content, { type: 'text', text: `arquivo gravado nesta máquina: ${slot.dest} (${slot.bytes} bytes)` }] } : result;
    } finally { if (id) uploads.delete(id); }
  }
  /** One MCP JSON-RPC message -> the response (or null for a notification). */
  async function handle(message) {
    const { id, method, params } = message ?? {}, reply = result => ({ jsonrpc: '2.0', id, result }), fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });
    if (message?.jsonrpc !== '2.0' || typeof method !== 'string') return id === undefined ? null : fail(-32600, 'Invalid Request');
    if (id === undefined || id === null) return null;   // notifications (initialized, cancelled ...)
    switch (method) {
      case 'initialize': return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: 'Ferramentas da página do APK Web Lab aberta no navegador (um app Android rodando no navegador). Comece por lab_status; screenshot devolve imagens; compose_tree e layout_bounds dão handles e chaves para as outras ferramentas. install_apk instala um .apk desta máquina, apps lista os instalados, open_app e close_app abrem e fecham (um app por vez). adb aceita linhas de comando do adb (adb help lista as interpretadas). record_screen grava a tela em vídeo (start, depois stop).' });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name; if (!TOOLS.some(tool => tool.name === name)) return fail(-32602, `ferramenta desconhecida: ${name}`);
        return reply(name === 'install_apk' ? await installApk(params?.arguments ?? {}) : name === 'adb' ? await adbCall(params?.arguments ?? {}) : name === 'record_screen' ? await recordCall(params?.arguments ?? {}) : await callPage(name, params?.arguments ?? {}));
      }
      default: return fail(-32601, `Method not found: ${method}`);
    }
  }
  return {
    handle, callPage, get connected() { return !!page; },
    listen: () => new Promise((resolve, reject) => { server = http.createServer(onRequest); server.once('error', reject); server.listen(port, host, () => { log(`ouvindo a página em http://127.0.0.1:${server.address().port} (origens: ${[...allowed].join(', ')})`); resolve(server.address().port); }); }),
    close: () => new Promise(resolve => { for (const waiter of pending.values()) clearTimeout(waiter.timer); pending.clear(); page?.res.end(); if (server) server.close(() => resolve()); else resolve(); }),
  };
}

/** The addresses an MCP client can use for a bridge bound to `host`: the loopback one, and for 0.0.0.0 every local IPv4 of this machine. */
export function mcpAddresses(host, port, token, interfaces = networkInterfaces()) {
  const hosts = host === '0.0.0.0' ? ['127.0.0.1', ...Object.values(interfaces).flat().filter(entry => entry && entry.family === 'IPv4' && !entry.internal).map(entry => entry.address)] : [host];
  return [...new Set(hosts)].map(name => `http://${name}:${port}/mcp/${encodeURIComponent(token)}`);
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
  const args = process.argv.slice(2), options = { port: DEFAULT_PORT, host: '127.0.0.1', serve: false, origins: [...DEFAULT_ORIGINS], token: null, timeoutMs: 60000 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'token') { console.log(readOrCreateToken()); process.exit(0); }
    else if (arg === 'serve') options.serve = true;
    else if (arg === '--host') options.host = String(args[++i]);
    else if (arg === '--port') options.port = Number(args[++i]);
    else if (arg === '--origin') options.origins.push(String(args[++i]).replace(/\/$/, ''));
    else if (arg === '--token') options.token = String(args[++i]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(args[++i]);
    else if (arg === '--help' || arg === '-h') { console.error('node lab-mcp.mjs [serve] [token] [--host 127.0.0.1] [--port 8790] [--origin <origem do lab>]... [--token <token>] [--timeout-ms 60000]  (ou o token em APK_WEB_LAB_MCP_TOKEN, como no JSON de Controles › MCP)'); process.exit(0); }
  }
  const chosen = resolveToken({ argToken: options.token, env: process.env });
  if (chosen.error) { process.stderr.write(`[lab-mcp] ${chosen.error}\n`); process.exit(1); }
  options.token = chosen.token;
  const bridge = createBridge(options);
  process.stderr.write(`[lab-mcp] token de pareamento: ${chosen.source}${chosen.source === tokenFile() ? ' (node lab-mcp.mjs token; cole em Controles › MCP › Token)' : ''}\n`);
  bridge.listen().then(port => {
    if (!options.serve) { serveStdio(bridge); return; }
    for (const address of mcpAddresses(options.host, port, options.token)) process.stderr.write(`[lab-mcp] MCP: ${address}\n`);
    process.stderr.write('[lab-mcp] no agente: claude mcp add --transport http apk-lab <um dos endereços acima>   ·   na página: Controles › MCP › Conectar   ·   Ctrl+C encerra\n');
  }, error => { process.stderr.write(`[lab-mcp] não abriu a porta ${options.port}: ${error.message}\n`); process.exit(1); });
  if (!options.serve) process.stdin.on('end', () => bridge.close().then(() => process.exit(0)));
  else for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => bridge.close().then(() => process.exit(0)));
}
