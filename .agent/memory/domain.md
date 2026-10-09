# Domain Memory — Projeto: [Nome]
> Criado em: 2026-09-11. Atualizado pelo /vibe-archive após cada feature.
> Contém: Regras de negócio específicas do produto, edge cases, decisões de produto.

<!-- Entradas adicionadas pelo /vibe-archive -->

## [2026-10-09] — [Feature ID: hydra-crawler-payment-tab-and-closure-reconciliation]
**Contexto:** Correção da discrepância financeira e de ciclo de vida de OSs no crawler (`os_deep_inspector.ts`, `deep-crawler.ts`, `db_repository.ts`), onde ordens faturadas/fechadas e quitadas (caso real OS #1856 Fusca Novo - Rei do Módulo, R$ 4.000 quitado via PIX) apareciam como "0% pago / R$ 4.000 pendente" devido à falta de ativação das abas AJAX do ASP.NET WebForms e reversão cega em checagem nominal.
**Regra aprendida:**
1. Ativação Sequencial das 9 Abas no Playwright (`ativarTodasAsAbas`): O ERP Oficina Inteligente utiliza `AjaxControlToolkit.TabContainer`. Abas secundárias (Pagamentos, Documentos, Notas, Agendamentos, Check-List, Garantias, Histórico, etc.) só têm seus UpdatePanels renderizados no DOM após o disparo real do evento de clique. A função `ativarTodasAsAbas` navega pelas 9 abas antes do parsing final, garantindo 100% de cobertura nos grids financeiros e cadastrais.
2. Detecção Factual de Bloqueio e Encerramento: A presença do banner `"O.S. fechada e bloqueada"` (`is_bloqueada_fechada: true`), de `data_fim` preenchida ou de saldo restante zerado com valor pago igual ao total determina sem ambiguidade que a OS está ENCERRADA (`is_aberta = 0`).
3. Proibição de Reversão Cega para ABERTA em Checagem Nominal: Ordens ausentes na grade de abertas (`TRANSICAO_PENDENTE`) nunca podem ser revertidas para `ABERTA` com base apenas no sucesso técnico da extração (`extracao_completa === true`). A reativação exige comprovação nominal ativa de status "ABERTO" e ausência de trava de bloqueio.
4. Sincronização Financeira Bidirecional em Transição Nominal: `formalizarTransicaoNominalOS` deve compulsoriamente atualizar `total_os`, `valor_pago`, `valor_restante`, `data_fim` e o `raw_payload` completo com as 9 abas, mantendo consistência no SQLite WAL.
**Risco identificado:** Alterações de layout no TabContainer do ERP podem quebrar seletores de clique de abas. Mitigado por fallbacks resilientes de texto e IDs parciais (`[id*="tapPagamento"]`).
**Não fazer:**
- Nunca extrair tabelas de abas AJAX no WebForms sem disparar previamente o evento de clique na respectiva aba.
- Nunca reabrir uma OS ausente de grade apenas porque a página de detalhe carregou com HTTP 200 / extracao_completa.
- Nunca deixar de sincronizar os campos financeiros quando uma OS formaliza transição de encerramento.

## [2026-10-08] — [Feature ID: hydra-harness-async-and-intent-hardening]
**Contexto:** Endurecimento crítico do harness e dispatcher do Hydra Agent (`dual_worker_router.ts`, `agent_dispatcher.ts`, `db_repository.ts`, `webhook-listener.js`) na VPS Linux, eliminando congelamento do event loop, vazamento de contexto de veículos/OS em mensagens subsequentes, timeouts de 90s em consultas de auditoria e loops de retry da Evolution API.
**Regra aprendida:**
1. Desacoplamento Assíncrono com `spawn` em CLI Workers: A chamada à CLI de IA (`agy`) NUNCA deve usar `spawnSync`. A execução síncrona congela 100% da thread do Node.js por 15s a 45s, bloqueando webhooks, reações 👀 e healthchecks. A função `spawnCliAsync` com Promise, streams acumulados e timer escalonado (`SIGTERM` -> `SIGKILL` após 1500ms) garante zero bloqueio no event loop.
2. Parser Pareado de Veículos e Precedência Estrita de Turno: Ao extrair entidades em mensagens informais (ex: `"detalhes do ka 465"`), o parser deve associar modelos conhecidos (`ka`, `c3`, `spin`, `etios`, etc.) a números isolados de 2 a 6 dígitos. Se o turno atual contém uma entidade explícita (modelo, OS ou placa), é ESTRITAMENTE PROIBIDO herdar `prevOsId`, `prevVehicleModel` ou `prevPlaca` do turno anterior. A anáfora só é permitida em perguntas puras sem entidades novas (ex: `"e o valor dele?"`).
3. Rotas Rápidas Determinísticas em SQL (Checklists e Pátio): Perguntas operacionais consolidadas como `"quais estao sem checklist de entrada? liste por loja"` e `"carros em patio [loja]"` não devem ser despachadas ao LLM. Consultas no SQLite WAL (`getChecklistAudit` e `getStoreDrilldown`) respondem deterministicamente em menos de 50ms, reduzindo a latência de 90.600ms (timeout `H-IA-02`) para 2ms-41ms.
4. Higienização de Ingress HTTP no Webhook: O parsing inicial de body com `JSON.parse` deve capturar `SyntaxError` e retornar imediatamente `HTTP 400 Bad Request` com `{ status: "bad_request", error: "Malformed JSON payload" }`. Retornar HTTP 500 faz com que a Evolution API interprete queda de serviço e realize retries infinitos com o mesmo payload quebrado.
**Risco identificado:** Vazamento de contexto entre conversas consecutivas onde o usuário mencionava um novo carro e o robô respondia dados do veículo anterior. Sanado com checagem booleana de `hasExplicitEntity`.
**Não fazer:**
- Nunca usar `spawnSync` em microsserviços Node.js que processem I/O de rede ou webhooks.
- Nunca permitir fallback cego para `prevOsId` quando a mensagem atual contiver qualquer identificador de veículo ou ordem de serviço.
- Nunca retornar HTTP 500 para requisições malformadas de webhook.

## [2026-10-08] — [Feature ID: watchdog-parser-and-safety-hardening]
**Contexto:** Endurecimento da extração de JSON e tratamento de restrições de moderação de IA no Watchdog (`/home/operacional/watchdog/worker.js`) na VPS Linux, eliminando quebras por streams interrompidos da CLI `agy` e bloqueios da Google Generative AI Prohibited Use policy.
**Regra aprendida:**
1. Extração Resiliente de JSON Multinível (`findLastValidAuditJson`): A resposta da CLI `agy` pode sofrer interrupções de stream ou emitir múltiplos blocos de markdown (ex: ````json ... ```` seguido por outro bloco de código autocorrigido sem fechamento). O método legado `.split('```json')[1]` quebrava nessas situações. A busca reversa varrendo delimitadores `{ ... }` e validando o schema de auditoria garante extração 100% confiável mesmo em payloads truncados.
2. Sanitização Prévia de Linguagem Sensível: Clientes e gerentes frequentemente trocam expressões ríspidas e palavras de baixo calão extremo em oficinas mecânicas. Ao interpolar o transcript bruto no prompt, o Google Gemini aciona o filtro de segurança `Generative AI Prohibited Use policy` e aborta a requisição. O módulo `lib/safety_sanitizer.js` substitui palavras extremas por marcadores neutros (`[linguagem_inapropriada]`, `[descontentamento_enfático]`), mantendo o sentido comercial da conversa sem acionar filtros da IA.
3. Descarte Gracioso de Bloqueios de Política (Anti-Retry Loop): Quando um prompt é recusado por política de IA, retentá-lo 3 vezes com intervalos de 60s/120s com o mesmo texto rejeitado é inútil. Ao detectar recusa de moderação, o worker tenta uma reanálise imediata com sanitização agressiva; se persistir recusado, o ciclo é finalizado graciosamente registrando a métrica e liberando a fila sem retransmissões desnecessárias.
**Risco identificado:** Retries cegos em conversas bloqueadas por política sobrecarregavam filas e mascaravam falhas na telemetria. Sanado pela detecção via `isSafetyPolicyError`.
**Não fazer:**
- Nunca extrair JSON de modelos de linguagem usando `split` estático de strings markdown.
- Nunca injetar transcrições brutas de WhatsApp com linguagem chula em prompts de IA sem camada prévia de higienização.
- Nunca re-enfileirar retries repetidos com exatamente o mesmo prompt rejeitado por política de segurança.

## [2026-10-08] — [Feature ID: hydra-os-360-full-details]
**Contexto:** Diagnóstico e resolução da inconsistência financeira e informacional no detalhamento de OSs do Hydra Agent (caso real OS #1916 ReiDoModulo), onde serviços discriminados mostravam apenas R$ 130 de uma OS de R$ 1.600 omitindo R$ 1.470 de reparo de bancada/peças, além de ignorar o Grafo de Atendimento e não reconhecer typos informais no WhatsApp como "taio x".
**Regra aprendida:**
1. Conciliação Financeira Completa da OS (Serviços + Peças + Bancada): Quando `valorTotal > totalServicos`, o ERP pode não possuir itens físicos detalhados na tabela de peças (ex: reparos terceirizados de bancada, reprogramação de módulos). O agente deve obrigatoriamente renderizar a conciliação financeira (`Componentes / Reparo de Bancada: R$ X,XX`), garantindo que a soma discriminada bata deterministicamente com o valor total da OS e saldo a receber.
2. Inclusão Mandatória do Grafo (`caseCtx`) no Detalhamento da OS: Quando o usuário solicita "raio-x", "detalhes" ou "ficha completa" de um veículo/OS, o bloco `> *Situação e Atendimento*` deve ser incluído na resposta, exibindo motivo operacional documentado, próximo passo prometido e data da última interação.
3. Tolerância Robusta a Typos no WhatsApp: Mensagens de gestores e sócios frequentemente trazem erros de digitação em teclados móveis (ex: `"nao, taio x da os 1916 por facor"`). A regex de intenção deve tolerar `taio x`, `raiox`, `raio-x`, `tudo`, `ficha`, `o que ta acontecendo` e pontuações informais.
4. Sanitização Estrita de Caracteres Monetários (Anti-NBSP): O método nativo `toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })` no V8/Node.js injeta espaços não-quebráveis (`\u00A0` e `\u202F`) entre o símbolo monetário e o valor numérico. Toda rotina monetária e sanitizador de WhatsApp deve compulsoriamente substituir `[\u00A0\u202F]` por espaço padrão `\u0020` para evitar quebras de layout e falhas em gates de conformidade.
**Risco identificado:** Omissão de dados de bancada gerava desconfiança dos sócios sobre o saldo financeiro real em pátio. Sanado via `OSDetailComplete` contendo `totalServicos` e `totalPecas` calculados no repositório.
**Não fazer:**
- Nunca omitir o saldo financeiro remanescente de uma OS mesmo se o cadastro de peças individuais vier vazio do ERP.
- Nunca emitir respostas secas de 6 linhas quando houver histórico e projeção de atendimento disponíveis no Grafo.
- Nunca enviar caracteres não-separáveis `\u00A0` ou asteriscos duplos `**` em mensagens WhatsApp.

## [2026-10-08] — [Feature ID: hydra-graph-agent-integration]
**Contexto:** Integração das buscas do Hydra Agent ao Grafo de Atendimentos (CaseMemoryReader / Fast-Path e MCP Tool get_os_case_history) e gerenciador de presença contínua WhatsApp (PresenceHeartbeatKeeper).
**Regra aprendida:**
1. Presença Contínua ("Digitando...") no WhatsApp: O status "composing" do WhatsApp expira em aproximadamente 5 a 10 segundos nos clientes. O `PresenceHeartbeatKeeper` implementa pulsing a cada 4.000ms com timeout defensivo de 60s e encerramento limpo via `finally`, garantindo que o usuário veja a indicação de digitação ininterrupta até a entrega dos balões.
2. Fast-Path Integrado ao Grafo de Atendimentos: Consultas de situação de OS utilizam o State Reducer projetado (`hydra_case_current_position` e `hydra_afirmacoes_analisadas`) para recuperar motivos de atraso, compromissos acordados e saldo de peças pendentes com zero chamadas de rede externas e complexidade O(1).
3. Anti-Alucinação Factual (Cláusula Pétrea): Se uma OS não possui análise ou causa de atraso documentada, o sistema declara explicitamente a limitação factual ("Não há causa de atraso registrada no histórico de conversas"), sendo terminantemente proibido supor falta de peças ou ausência de mecânico.
4. Segregação e Isolamento Cross-Store: Gerentes de loja possuem escopo estritamente isolado (`persona: 'gerente'`). Qualquer tentativa de acessar dados ou candidatos de outra unidade resulta em bloqueio antecipado via `SecurityAccessDeniedError`, sem vazar placas ou números de OS.
5. Formatação WhatsApp Nativa: Balões operacionais eliminam asteriscos duplos `**` e convertem espaços não-separáveis `\u00A0` gerados por formatações monetárias em espaços padrão `\u0020`.
**Risco identificado:** Falhas na inicialização do banco SQLite em memória ou esquemas legados sem migração de tabelas de caso. Mitigado pela migração idempotente `ensureCaseAnalysisTables(db)` injetada no boot de `db_repository.ts`.
**Não fazer:**
- Nunca usar instâncias ou números de gerentes de loja para envio de mensagens WhatsApp (apenas instâncias institucionais `hydra` e `atendimento`).
- Nunca assumir silêncio do cliente ou atraso por peças sem evidência factual registrada na análise da conversa.
- Nunca deixar de encerrar o heartbeat de presença no bloco `finally`, prevenindo vazamento de intervalos ativos em memória.

## [2026-10-07] — [Feature: Watchdog Sliding Idle Debounce]
**Contexto:** Transição da arquitetura de acumulação de conversas no Watchdog de Janela Fixa (Fixed Window com SETNX) para Janela Deslizante de Inatividade (Sliding Idle Debounce) de 20 minutos com teto máximo de segurança de 2 horas.
**Regra aprendida:**
1. Janela de Inatividade (Sliding Debounce): Não utilizar trava estática na primeira mensagem (`SETNX`) para conversas de atendimento dinâmico. A cada mensagem nova (cliente ou gerente), o TTL da chave de debounce e o score no ZSET de agendamentos (`watchdog:scheduled_evals`) devem ser prorrogados para `now + IDLE_GAP_SECONDS` (20 min). A análise só é disparada quando a conversa atinge silêncio absoluto.
2. Proteção contra Inanição (Ceiling Guard): Conversas ativas sem pausa não podem ser adiadas indefinidamente. O timestamp do início do lote (`debounce_start:conv`) deve limitar a prorrogação ao teto de `burstStart + MAX_ACCUMULATION_SECONDS` (2 horas).
3. Ciclo Coordenado de Limpeza: O Worker deve limpar tanto a chave efêmera de debounce quanto a chave de início de lote (`debounce_start:conv`) ao finalizar a auditoria ou descartar conversas ignoradas/vazias, garantindo que o próximo lote comece sem resquícios do ciclo anterior.
**Risco identificado:** Se o buffer de mensagens não tiver TTL superior ao teto máximo (2h), mensagens iniciais de conversas longas podem expirar antes do processamento. O TTL do buffer foi estendido para `MAX_ACCUMULATION_SECONDS + 600s`.
**Não fazer:**
- Nunca usar `SETNX` estático para agendamento de auditoria de conversas conversacionais ativas.
- Nunca disparar análise de atendimento enquanto o interlocutor ou gerente ainda estiver enviando mensagens dentro da janela de diálogo.

## [2026-10-06] — [Feature: Hydra Pátio — Reconciliação Diária de OS & Ciclo de Quitação]
**Contexto:** Automação da conciliação diária de veículos em pátio e ordens de serviço por loja no ERP Oficina Inteligente, com rastreamento persistente do ciclo de vida das OSs (Ledger Mensal), layout corporativo idêntico ao modelo de referência (`CONCILIAÇÃO 2608.xlsx`) alinhado à estética Slate de Juros Rede, e disparo via WhatsApp às 08:00 AM para o financeiro.
**Regra aprendida:**
1. Máquina de Estados de Quitação no Mês (Monthly Ledger): Uma OS que quita (saldo atinge R$ 0,00) não deve ser removida sumariamente do relatório no dia do fechamento. Ela é apresentada com `Valor: 0` e o meio de quitação em `PAGAMENTOS:`, permanecendo listada com valor 0 nos dias seguintes até o encerramento do mês civil. Na virada do mês, o rollover purga as zeradas e preserva apenas as OSs com saldo em aberto.
2. Identificação da Coluna de Data (`Data Entrada:`): A data extraída do relatório de conferência do ERP refere-se à abertura da OS / entrada do veículo no pátio. O cabeçalho deve ser explicitado como `Data Entrada:` para eliminar ambiguidade em relação a datas de faturamento ou baixa.
3. Conversão de Seriais Nativos do Excel: Datas brutas exportadas pelo ERP como seriais (ex: `46274`, `46273`) devem ser convertidas deterministamente via `parseExcelDateOrString` para o padrão brasileiro `DD/MM/YYYY`, impedindo a exibição de números inteiros de data.
4. Identidade Visual Slate Unificada: Padrão estético alinhado ao Juros Rede (Banner Slate 800 `#1E293B`, cards de lojas Slate 700 `#334155`, subheaders Slate 100 `#F1F5F9`, tipografia `Segoe UI`, zebra striping `#F8FAFC` e bordas duplas em subtotais) proporciona acabamento executivo de alto padrão.
5. Sincronismo Matinal Duplo: As rotinas de Pátio (07:30 AM) e Juros Rede (07:50 AM) rodam com buffer de segurança e disparam seus respectivos relatórios cravadas às 08:00:00 AM para o WhatsApp do financeiro (+55 11 94066-7032).
**Não fazer:**
- Nunca remover OS quitada no mesmo dia em que o saldo zerar.
- Nunca deixar datas em formato numérico serial do Excel.
- Nunca expor o financeiro a logs técnicos em caso de erro (contingência exclusiva para o dev).

## [2026-10-06] — [Feature: Hydra Rede — Relatório de Juros Diário & Layout A4 Delimitado]
**Contexto:** Automação completa do crawler Meu Rede para 10 lojas credenciadas com extração de transações individuais via fila S3, preenchimento elástico da planilha de juros/taxas em layout delimitado A4 Paisagem, disparo diário pontual às 08:00 AM via WhatsApp e canal de contingência exclusivo para o desenvolvedor.
**Regra aprendida:**
1. Motor Elástico Anti-Quebra: Dimensionamento vertical elástico por par de lojas (`blockDataRows = Math.max(vendasLojaEsq, vendasLojaDir, 1)`). Impede sobreposição e colisão de células em dias de pico (testado e comprovado com até 60 vendas em uma única loja sem truncamento).
2. Saneamento Anti-DIV/0: Fórmulas de taxas devem sempre usar a condicional segura `=SE(Bruto>0; Líquido/Bruto-1; 0)` (ou `=IF(C>0, (D/C)-1, 0)`), eliminando 100% dos erros `#DIV/0!` em linhas sem venda.
3. Impressão A4 Paisagem (OpenXML): A área de impressão deve ser restrita às colunas de dados reais (`A1:M[maxRow]`), expurgando referências legadas que apontavam para a coluna 16.384 (`XFD`) e miniaturizavam a impressão.
4. Resumo Executivo em 1 Folha: Aba compacta de 10 linhas travada em `fitToWidth: 1` e `fitToHeight: 1` garante entrega de 1 folha física para diretoria em qualquer impressora.
5. Buffer Matinal (07:50 AM -> 08:00 AM): O scraper inicia às 07:50 AM para garantir processamento completo com antecedência, e a função `aguardarHorarioAlvo(8, 0)` segura o disparo para liberar o envio exatamente às 08:00:00 AM.
6. Roteamento de Erros / Anti-Spam de Cliente: O cliente (`+55 11 94066-7032`) recebe apenas mensagens oficiais e planilhas válidas. Erros técnicos, timeouts ou falhas de scraping são roteados exclusivamente para o número do Dev (`11996242812`) acompanhados dos últimos logs.
**Não fazer:**
- Nunca usar limites estáticos de linhas por loja em planilhas que processam volumes variáveis de vendas.
- Nunca deixar fórmulas com divisão por zero sem proteção condicional `=IF(Bruto>0, ...)`.
- Nunca enviar mensagens de erro ou logs técnicos brutos para o WhatsApp do cliente.


## [2026-09-29] — [Feature: Hydra Financial Engine e Fluxo Conversacional Multi-Turno]
**Contexto:** Integração dos Agentes 1 e 2 do ecossistema Hydra na VPS. Consultas de metas (goal_gap), CMV, faturamento por área, canais de mídia e continuidade de diálogo (anáfora, elipses, reset de rede).
**Regra aprendida:**
1. Base de Cálculo de CMV: O sistema Oficina Inteligente calcula `% C.M.V` = `(custo_total / faturamento_total) * 100` sobre o faturamento bruto (`faturamento_bruto`).
2. Rastreabilidade de Custos: O custo consolidado da linha total é o somatório aritmético exato das linhas de áreas.
3. Governança da Rede: A loja Master é puramente administrativa e deve ser expurgada das análises operacionais (10 de 11 lojas elegíveis).
4. WhatsApp First: Perguntas sobre metas e CMV devem responder a métrica principal no topo (`cmvPercentual` em primeiro lugar; falta e atingimento antes de listar lojas). Proibido markdown tables, asteriscos duplos e código monoespaçado.
5. Isolamento e Anáforas: Perguntas de elipse pura ("E Santo André?") herdam a operação anterior (`financial_alerts`, `store_cmv`, `store_areas`, `media_survey`). Anáforas de loja ("E o CMV dela?", "Qual área tá pior?") resolvem para a loja em contexto. Expressões generalistas ("Agora o faturamento das lojas", "da rede") quebram a herança de loja e resetam para escopo global.
**Não fazer:**
- Nunca responder com Raio-X Operacional ou OSs aleatórias quando dados financeiros de uma loja não estiverem disponíveis (retornar status transparente de ausência).
- Nunca mascarar ausência de meta como `R$ 0,00`.
- Nunca truncar silenciosamente a lista de lojas para top 3 quando o usuário solicitar faturamento das lojas.

## [2026-09-29] — [Feature: Confirmação de Recebimento (👀) e Digitando Contínuo no WhatsApp]
**Contexto:** Implementação de confirmação ultra-rápida de recebimento via reação 👀 vinculada ao `messageId` original e manutenção contínua do estado "digitando" (`composing`) durante todo o processamento de consultas assíncronas no webhook do Hydra.
**Regra aprendida:**
1. Contrato da Evolution API v2: A rota `/message/sendReaction/{instance}` exige payload estrito com objeto `{ key: { remoteJid, fromMe: false, id: messageId }, reaction: "👀" }`. Reações só devem ser enviadas para mensagens reais de entrada com ID da Evolution.
2. Não-bloqueio do Ingress: A reação 👀 deve ser disparada de forma assíncrona não-bloqueante no ingress imediatamente após validação de whitelist e deduplicação em SQLite (`webhook_dedup`), permitindo resposta HTTP 200 ao webhook em < 15ms.
3. Idempotência de Reação: Estado de reação auditado na tabela `message_reactions` vinculada ao `message_id`. Replays de webhooks são ignorados pelo SQLite e nunca disparam reações duplicadas.
4. Heartbeat de Presença (Anti-Timeout Baileys): O Baileys/Evolution encerra o estado `composing` após o parâmetro `delay` ou ~15s. Para consultas longas (3 a 17s), o `TypingManager` renova `composing` (delay 4500ms) a cada 3500ms e dispara `paused` explícito imediatamente antes do primeiro balão.
5. Processamento Assíncrono Desacoplado: O dispatcher deve ser executado via `execFile` assíncrono (Promisificado), nunca `execFileSync`, mantendo o event loop do Node.js livre para renovação pontual de timers e respostas concorrentes de `/health`.
6. Concorrência Per-Chat: Filas seriais independentes por telefone (`chatQueues`) garantem ordem estrita FIFO dentro do mesmo chat, enquanto conversas de números diferentes processam concorrentemente sem bloqueio mútuo.
**Não fazer:**
- Nunca usar `execFileSync` no listener do webhook (congela o event loop e mata os timers de presença).
- Nunca adicionar delays artificiais (700-1500ms) antes do primeiro balão (a presença já reflete o trabalho real).


## [2026-09-29] — [Feature: Encavalamento de Mensagens, CMV da Rede e Evidências Multimodais]
**Contexto:** Implementação do agrupador de mensagens encavaladas (`MessageBatcher`), cálculo e apresentação de CMV consolidado da rede (razão ponderada), comparativo de lojas e pior loja, blindagem anti-regressão de slug genérico e contratos unificados de mídia multimodal (`InboundPart`, `MediaEvidence`).
**Regra aprendida:**
1. Janela de Encavalamento (Debounce Deslizante): Usuários no WhatsApp fragmentam mensagens ("qual o CMV" + "da rede"). O `MessageBatcher` aplica debounce deslizante de 700ms com teto máximo de 2000ms por conversa, deduplica messageIds e unifica o texto canônico antes de passar ao dispatcher.
2. Não-Disparo de Digitando Durante Espera: O estado "digitando" (`composing`) NUNCA deve ser ativado durante o período de 700ms em que mensagens estão sendo aguardadas no lote; inicia-se apenas quando o lote fecha e a fila assíncrona pega o trabalho.
3. Fórmula Ponderada de CMV da Rede: O CMV consolidado da rede é estritamente `sum(custos) / sum(faturamento) * 100` (ex: `63.556,72 / 340.885,21 = 18.64%`), NUNCA a média aritmética dos percentuais das lojas (19.14% é matematicamente proibido).
4. Blindagem Anti-LOJA: Slugs vazios, genéricos ou de rede (`""`, `"loja"`, `"LOJA"`, `"lojas"`, `"rede"`, `"todas"`) devem ser sumariamente rejeitados pela consulta de loja única (`queryStoreCMV`) e redirecionados para escopo de rede (`queryUnifiedCMV`), eliminando a mensagem espúria `"não há CMV da loja LOJA"`.
5. Apuração Parcial Transparente: Lojas sem dados de CMV capturados (ex: 3 apuradas de 10 elegíveis) devem ser explicitadas como `"dado não disponível"`, NUNCA mascaradas como `0.00%`.
6. Data de Atualização: O rodapé de mensagens financeiras deve usar `capturedAt` / `created_at` da coleta (ex: 29/09/2026), NUNCA o fim do período contábil (`data_fim`, 30/09).
**Não fazer:**
- Nunca usar média aritmética de porcentagens para consolidados de rede.
- Nunca emitir `"não há CMV da loja LOJA"`.
- Nunca mascarar lojas sem relatório de operação com custo ou CMV de `0.00%`.

## [2026-09-29] — [Fix: Ingress Evolution Webhook e Anti-Loop de Status]
**Contexto:** Correção da entrega de mensagens reais WhatsApp da Evolution API para o listener Hydra (`http://172.18.0.1:3333`).
**Regra aprendida:**
1. Contrato de Mensagens da Evolution API: O deserializador Baileys (`prepareMessage`) da Evolution sempre injeta `status: "DELIVERY_ACK"` em todas as mensagens normais de entrada (`messages.upsert`).
2. Filtro Anti-Loop: O listener NUNCA deve verificar `payload?.data?.status` como critério de descarte. Essa verificação descarta silenciosamente 100% das mensagens reais enviadas pelo WhatsApp. A proteção anti-loop deve inspecionar estritamente: `payload?.data?.key?.fromMe === true`, `payload?.message_type === "outgoing"`, `payload?.event === "messages.update"` e `payload?.data?.key?.remoteJid === "status@broadcast"`.
3. Reação com LID: Reações 👀 em chats LID devem preservar o `payload?.data?.key?.remoteJid` original (ex: `...@lid`), permitindo que a Evolution localize a chave correta da mensagem e entregue o emoji com status HTTP 201.
4. Telemetria de Estados por ID: Cada mensagem deve transitar por estados auditáveis em SQLite (`hydra_accepted -> batch_closed -> job_processing -> job_processed -> whatsapp_sent`), garantindo que o HTTP 200 do webhook signifique aceite efetivo na fila.
**Não fazer:**
- NUNCA usar `payload?.data?.status` no webhook listener.
- NUNCA descartar mensagens de entrada sem gravar estado em `message_lifecycle`.


## [2026-09-30] — [Fix: Ingress de Status e Ciclo Completo de Reações em Produção]
**Contexto:** Correção de regressão onde `Boolean(payload?.data?.status)` em `webhook-listener.js` interceptava mensagens normais (`messages.upsert`), e validação do ciclo 👀 -> digitando -> balão -> ✅ em produção sob PM2.
**Regra aprendida:**
1. Tratamento de Updates de Status: Eventos de entrega e leitura devem rodar EXCLUSIVAMENTE quando `payload?.event === "messages.update"`. Como a Evolution injeta `status: "DELIVERY_ACK"` nas mensagens de entrada (`messages.upsert`), qualquer checagem genérica de `payload?.data?.status` intercepta o fluxo e descarta as mensagens como se fossem acks de entrega.
2. Ciclo de Reação Completo: A reação 👀 é disparada no aceite do webhook (<15ms, HTTP 201 na Evolution); durante a geração o TypingManager renova a presença `composing`; após a entrega de todos os balões com HTTP 201, a reação ✅ é disparada para todos os messageIds do lote.
3. Timeout do Dispatcher: A execução assíncrona do `agent_dispatcher_cli` deve ter timeout de 120s para acomodar cold starts de LLM sem falhas prematuras.
**Não fazer:**
- NUNCA checar `Boolean(payload?.data?.status)` no topo do `handleIncomingPayload`.

## [2026-09-30] — [Feature ID: hydra-memory-rag-isolation]
**Contexto:** Memória atômica estruturada, validador determinístico contra alucinação factual, consolidação sem LLM em America/Sao_Paulo e RAG com isolamento estrito de escopo efetivo.
**Regra aprendida:**
1. Validador Determinístico Equilibrado: Rejeita fatos transitórios e operacionais pontuais (saldos de OS em aberto, valores monetários explícitos em R$, faturamentos de datas concretas e placas de veículos). Aceita regras e preferências legítimas de formato/negócio, mesmo que contenham números, o símbolo "%" ou o termo "faturamento" (ex: "prefiro faturamento antes de OS", "mostre CMV em % com duas casas", "retidos significa mais de 5 dias").
2. Regra da Confiança do Modelo: Uma confiança >= 0.8 informada pelo modelo NÃO promove inferência a preferência confirmada. Interesses derivados (`derived_interest`) entram estritamente com status `candidate` e só são promovidos a `active` se confirmados em no mínimo 2 dias distintos na consolidação semanal.
3. Agrupamento Quíntuplo Completo: Memórias são agrupadas por `(phone, generation_id, scope_type, loja_slug, topic_key)`. O mesmo operador gerenciando duas lojas diferentes mantém memórias 100% segregadas por loja.
4. Deduplicação Estável por Turno: IDs de mensagem e turno (`source_turn_ids`) são armazenados em JSON no registro; reprocessamento de webhooks repetidos ou reexecução de jobs não incrementa contadores de ocorrência.
5. Consolidação 100% Determinística: As rotinas diária e semanal operam diretamente no SQLite sem nenhuma chamada a APIs de LLM e sem mensagens externas ao WhatsApp (zero tokens consumidos, zero custo operacional). Watermarks em `America/Sao_Paulo` cobrem dias completos sem corte arbitrário.
6. Isolamento RAG de Escopo Efetivo: Um usuário com perfil de Sócio (`allowedStores = ['*']`), ao alternar temporariamente para Gerente (`/jorgeberetta`), tem seu RAG estritamente confinado a `((scope_type = 'loja' AND loja_slug = :activeLojaSlug) OR scope_type = 'perfil_global')`. Memórias com `scope_type = 'rede'` JAMAIS atravessam para o contexto ou ferramentas do gerente.
7. Blindagem Pós-Reset: O comando `/reset` incrementa a geração (`memoryGeneration`). Jobs de consolidação ou indexação atrasados que tentarem gravar registros com geração inferior à ativa do perfil são abortados com rollback determinístico.
**Risco identificado:** A criação de novas personas operacionais no futuro deve garantir que qualquer perfil restrito a loja nunca herde o escopo de rede sem validação explícita de permissão.
**Não fazer:**
- NUNCA salvar dados transacionais ou valores monetários voláteis na memória duradoura do usuário.
- NUNCA promover inferência derivada para preferência confirmada sem confirmação em dias distintos.
- NUNCA liberar memórias de rede (`scope_type = 'rede'`) para perfis operando como gerente de loja.
- NUNCA executar chamadas ao LLM para rotinas de consolidação diária ou semanal.

## [2026-10-05] — [Feature ID: hydra-os-conversation-context]
**Contexto:** Auditoria e correção definitiva do Incidente Linea/Jabaquara (Versão 2.1). Consulta e desambiguação de situação de veículo por modelo e loja em linguagem natural, acoplamento estrito de análises prévias existentes com ERP, segregação de operações (situação vs contagem vs listagem), mitigação de reparações conversacionais pós-desvio e pós-reset, e barreira antecipada de isolamento cross-store.
**Regra aprendida:**
1. Resolução de Veículo sem Resumo de Loja: Perguntas como "fala sobre o linea do jabaquara" delimitam o alvo individual pelo modelo ("linea") e unidade ("jabaquara"). Jamais devem desviar para resumo financeiro agregado, faturamento ou metas da unidade.
2. Reparação Conversacional e Reset: Frases de correção ("uaai não foi isso que eu te pedi", "quero entender o carro") detectam anulação de contexto prévio e foco no veículo alvo. Após `/reset`, a nova geração de memória (`memoryGenerationId`) invalida o cache e permite identificar o veículo sem exigir histórico de turnos anteriores.
3. Segregação Semântica de Operações: "Como tá o Linea" (situação individual), "Quantos Linea temos" (contagem de veículos), "Liste os Linea" (listagem de veículos) e "Como tá o Jabaquara hoje" (resumo de loja) são planos distintos com dimensões, filtros e agregações próprios. A presença do modelo não pode virar situação individual se a intenção for contagem, nem a presença da loja pode apagar o modelo.
4. Vínculo Estrito com Análises Existentes: Ter `conversationId` persistido não basta para vincular conversa à OS. O vínculo só é atribuído se a loja for idêntica e a OS constar expressamente em `coveredOsIds` da análise. Sem vínculo comprovado, entrega-se dados cadastrais do ERP com declaração de limitação de cobertura.
5. Modo Padrão com Zero Chamadas de Rede: O caminho padrão consome o ERP e o repositório de análises existentes (`IAnalysisRepository`) com exatamente ZERO chamadas incrementais de mensageria à Evolution/Chatwoot. Leitura de mensagens brutas é restrita ao Modo Complementar sob demanda.
6. Falha Técnica Distinta de Não Encontrado: Timeout ou indisponibilidade de banco gera balão técnico de indisponibilidade (`UNAVAILABLE`) preservando o alvo solicitado. NUNCA emitir "veículo não encontrado" diante de erro técnico.
7. Cache Multi-Fatorial: A chave de cache deve incluir loja, OS, placa maiúscula, persona, generationId, versão da análise e updatedAt do ERP. Mensagens editadas com mesmo ID ou novo turno pós-reset invalidam compulsoriamente a entrada.
**Risco identificado:** Adição de novos modelos de veículos deve preservar a busca parametrizada contra o campo `veiculo` no banco operacional sem filtros rígidos com listas estáticas fechadas.
**Não fazer:**
- NUNCA emitir resumo agregado de faturamento ou metas quando o usuário pedir a situação de um veículo específico.
- NUNCA assumir perfil de 'sócio' silenciosamente quando o contexto de segurança estiver ausente (lançar `SecurityAccessDeniedError`).
- NUNCA escolher arbitrariamente `rows[0]` diante de múltiplos veículos do mesmo modelo na mesma unidade (sempre desambiguar com lista de placas).
- NUNCA reler mensagens brutas de rede a cada consulta no modo padrão.
## [2026-10-06] — [Feature ID: hydra-manager-leads-mcp & hydra-manager-leads-formatting-v2]
**Contexto:** Servidor MCP SSE público (Traefik/Cloudflare em `https://bot.tork.services/mcp/sse`) para robôs de atendimento notificarem gerentes das 10 lojas sobre novos agendamentos e cancelamentos via WhatsApp oficial (`atendimento`), com formatação visual nativa clean e trava de segurança estrita.
**Regra aprendida:**
1. Isolamento de Protocolo MCP em SSE Multi-Sessão: No `@modelcontextprotocol/sdk`, cada `Server` está estritamente vinculado a um transporte. Em arquiteturas SSE onde o cliente reconecta ou abre turnos múltiplos, cada conexão HTTP `GET /mcp/sse` deve instanciar seu próprio `Server` via factory (`createLeadMcpServer` com `onMcpServerCreated`). Compartilhar um singleton global em múltiplos transportes causa `Error: Already connected to a transport` e derruba a stream do robô (`stream-connection-error`).
2. Trava Incondicional de Homologação (`MCP_FORCE_RECIPIENT`): A trava de teste deve operar na camada mais profunda (`getEffectiveRecipientPhone`), interceptando qualquer envio e direcionando para o telefone de teste (`5511996242812`) com banner explicativo no topo do balão. Os gerentes reais NUNCA devem ser contatados durante baterias de teste.
3. Formatação Nativa Clean Anti-Spam: Mensagens para gerentes devem adotar estrutura compacta com cabeçalho de loja, horário em destaque, lista com marcadores (`- *Campo:* Valor`) e telefone formatado `(XX) XXXXX-XXXX`. Emojis de alerta tipo sirene geram poluição visual e rejeição operacional.
4. Resolução Imediata de Loja no Chatbot: Se o cliente citar a unidade ou bairro da oficina (ex: "Kennedy", "Mauá"), o agente deve travar a unidade como resolvida na hora e apresentar a grade de horários, proibindo insistência repetitiva em pedir bairro/endereço.
5. Zero Vazamento de Logs no Chat do Cliente: Textos de status interno ("Notificação enviada à unidade...") jamais devem vazar para o cliente; o robô deve responder apenas a confirmação acolhedora e transbordar para humano.
**Risco identificado:** Remoção precipitada de `MCP_FORCE_RECIPIENT` antes de validar todas as unidades pode enviar notificações de simulação para gerentes em seus números reais.
**Não fazer:**
- NUNCA reutilizar uma única instância singleton de `Server` para múltiplas conexões concorrentes SSE.
- NUNCA enviar notificações reais para os 10 gerentes sem validação explícita prévia.
- NUNCA permitir que o bot repita perguntas de localização quando a loja já foi expressamente indicada pelo cliente.
- NUNCA vazar mensagens de status de ferramentas internas para a tela de atendimento do lead.

## [2026-10-06] — [Feature ID: hydra-context-router-and-audit-sync]
**Contexto:** Correção sistêmica de sequestro de contexto pelo resolvedor de veículos, resolução de anáforas de OSs em turnos subsequentes, ancoragem de fallback determinístico pós-timeout da LLM, extração horária de CMV (Gestão Periódica) e slotting de briefings executivos vespertinos.
**Regra aprendida:**
1. Precedência Financeira Incondicional: Perguntas com palavras-chave financeiras ou de métricas (`faturamento`, `venda`, `meta`, `cmv`, `ranking`, `ticket`) têm precedência absoluta (`isExplicitFinancialQuery`). Jamais devem ser capturadas pelo resolvedor de veículos na Seção 2.5, mesmo se citarem nomes de lojas ou expressões de cortesia ("por favor").
2. Trava Estrita de Estado Pendente: A captura de respostas de desambiguação por `prevPending` exige estritamente `deliveryStatus === 'PENDING_CHOICE'`. Registros com status `DELIVERED` jamais devem interceptar mensagens futuras.
3. Resolução de Anáfora de OS: Quando o usuário solicitar detalhes sem número explícito ("me de detalhes da os", "fale mais dela"), o despachador deve herdar o `osId` citado na resposta anterior do bot (`lastResponseText`), entregando serviços discriminados e formas de pagamento diretamente via `getOSDetails` sem timeout de LLM.
4. Ancoragem de Contexto no Fallback de Timeout: Se o motor LLM atingir timeout (60s), o fallback determinístico (`FALLBACK_API`) deve injetar `inferredOsId` e `currentStore` no `canonical`, impedindo chamadas irrestritas a `retrieveOperationalData` sem filtros (que vazavam OSs aleatórias de outras lojas).
5. Validação de CMV Tolerante a Início de Mês: A validação em `validarIntegridadeRelatorioOperacao` deve aceitar `faturamento_total >= 0` e `cmv_percentual >= 0`, pois no início do mês lojas podem faturar antes do lançamento de custos de peças sem que isso represente corrupção de dados.
6. Slotting de Briefings Executivos: A chave de idempotência de despachos diários (`hydra_briefing_dispatches`) deve utilizar sufixo de slot (`briefing_executivo_matutino` vs `briefing_executivo_vespertino`), garantindo que o disparo das 14:00/17:00 com dados consolidados atualizados não seja suprimido pelo disparo das 06:00/09:00.
**Risco identificado:** A inclusão de CMV na rotina horária adiciona chamadas de extração por loja; o tempo total de execução deve ser monitorado para permanecer dentro da janela do lock compartilhado (`flock -w 3600`).
**Não fazer:**
- NUNCA reativar desambiguação de veículo quando o estado anterior já foi entregue (`deliveryStatus === 'DELIVERED'`).
- NUNCA permitir que o fallback determinístico execute buscas abertas de OS na rede para perguntas contextuais.
- NUNCA rejeitar relatórios de operação com CMV = 0% nos primeiros dias do mês.
- NUNCA usar chave diária única sem slot para briefings executivos que possuem múltiplos envios programados no dia.

## [2026-10-07] — [Regra Cardinal de Segurança: Proibição de Envio por Instâncias de Gerentes]
**Contexto:** Bloqueio incondicional de instâncias de gerentes de lojas físicas para disparos de saída (outbound).
**Regra aprendida:**
1. **PROIBIÇÃO ABSOLUTA DE ENVIO POR INSTÂNCIAS DE GERENTES:** Instâncias de WhatsApp atribuídas a lojas ou gerentes (ex: `Maua`, `Jorge Beretta`, `Kennedy`, `Dom Pedro`, `Rudge`, `Jabaquara`, `Piraporinha`, `Planalto`, `Carijós`, etc.) pertencem a aparelhos operacionais de terceiros e NUNCA podem ser utilizadas como remetentes de nenhuma mensagem, nem mesmo para testes locais.
2. **Instâncias Emissoras Exclusivas Autorizadas:** O sistema e os agentes têm permissão estrita para despachar mensagens exclusivamente por:
   - `hydra` (Bot Operacional Interno - `5511917837618`)
   - `atendimento` (Central de Atendimento ao Cliente - `5511917698769`)
   - Qualquer outra instância futura EXIGE autorização expressa por escrito do usuário e JAMAIS pode pertencer a gerentes.
3. **Barreira Programática no Código:** O `WhatsAppClient` deve validar a instância contra `ALLOWED_SENDER_INSTANCES = new Set(['hydra', 'atendimento'])`. Se qualquer script ou função tentar disparar por instância fora da whitelist, deve lançar erro fatal imediato sem efetuar a chamada HTTP.
**Risco identificado:** O uso de instâncias de gerentes como remetente faz mensagens saírem do aparelho do gerente, poluindo seu histórico e quebrando a governança do canal.
**Não fazer:**
- NUNCA colocar o nome de instâncias de lojas/gerentes como `instance` no `WhatsAppClient` ou em scripts de teste.
- NUNCA testar conectividade ou envio usando instâncias que não sejam `hydra` ou `atendimento`.

## [2026-10-07] — [Feature ID: hydra-intent-refinement-v2]
**Contexto:** Substituição de concatenações manuais de histórico e heurísticas frágeis de regex/palavras-chave por persistência nativa de conversas multi-turn do AGY CLI (`--conversation <id>` com `--output-format json`), armazenamento do `agy_conversation_id` no SQLite por telefone, limpeza compulsória no `/reset`, blindagem contra contaminação por herança acidental de OSs anteriores e correção de formatação blockquote do WhatsApp no relatório de CMV.
**Regra aprendida:**
1. **Persistência Nativa de Sessão no AGY CLI:** O AGY CLI suporta `--conversation <uuid>` mantendo todo o histórico de diálogo e tool calls no subdiretório `brain/`. Ao usar `--output-format json`, o AGY CLI retorna `conversation_id` no JSON raiz (`{"conversation_id": "...", "status": "SUCCESS", "response": "..."}`). Não é necessário injetar resumos manuais de histórico no prompt a cada turno.
2. **Ciclo de Vida da Sessão por Telefone:** O `agy_conversation_id` deve ser persistido na tabela `hydra_turn_contexts` no SQLite. No primeiro turno, a conversa é iniciada com as instruções de MCP; nos turnos seguintes, envia-se diretamente o texto do operador com `--conversation <id>`.
3. **Limpeza Determinística no `/reset`:** O comando `/reset` deve compulsoriamente executar `clearAgyConversationId(db, phone)`, garantindo que o próximo turno crie uma sessão totalmente nova e limpa.
4. **Desacoplamento de Anáforas no Fallback:** A herança de `inferredOsId` no fallback só pode ocorrer se a intenção for expressamente anáfora sobre aquela OS (`isAnaphoraOSRequest`). Nunca deve contaminar consultas sobre lojas ("OSs jorge beretta") ou relatórios de rede.
5. **Formatação WhatsApp Estrita em Citações:** Toda linha complementar de cabeçalho em cartões de métricas (ex: `*Período:*`) deve conter o prefixo `> ` para evitar quebra do bloco de citação no WhatsApp mobile.
**Risco identificado:** Se o tempo limite global do turno for muito curto (<60s), múltiplas chamadas consecutivas de ferramentas MCP durante a consulta podem acionar o fallback antes da conclusão natural do modelo. O orçamento de 90s garante margem confortável.
**Não fazer:**
- NUNCA tentar adivinhar a intenção do operador com dezenas de regexes semânticas quando a persistência da LLM puder manter o contexto natural.
- NUNCA injetar `inferredOsId` de turnos passados em consultas que especificam lojas ou temas gerais.
- NUNCA esquecer de limpar o ID de conversa externa ao processar o comando `/reset`.

## [2026-10-08] — [Feature ID: hydra-patio-engine-reconstruction]
**Contexto:** Reestruturação completa do motor de conciliação diária de Carros em Pátio & OS (Modelo Canônico D-1), ingestão nativa direta a partir dos arquivos granulares do Hydra Bot na VPS (`/home/operacional/hydra-data/crawls`), calibração visual precisa (linha inteira âmbar para saídas de pátio vs. célula azul isolada com badge 🔵 para pagamentos novos de ontem) e automação em cron pós-crawler sem conflito de locks com os workers de financeiro.
**Regra aprendida:**
1. **Regra Canônica de Carros em Pátio:** Carro em pátio ativo é definido por `isAberta === 1` (continua na oficina física, inclusive com saldo zero ou de meses anteriores). A saída do pátio é unicamente identificada pela data de encerramento (`isAberta === 0` com finalização em D-1).
2. **Anti-Duplo Desconto no Saldo:** O campo `restanteERP` informado pelo sistema já abate todos os pagamentos realizados. O bot nunca deve subtrair novamente os pagamentos do dia desse saldo.
3. **Ordenação Unificada:** As OSs de cada loja devem ser ordenadas de ponta a ponta de forma contínua pelo número da OS (decrescente: `osNumber DESC`), sem divisão arbitrária por blocos de saldo devedor vs quitadas.
4. **Isolamento de Destaque Visual:** Ordens abertas que receberam pagamento em D-1 devem ter destaque estritamente na célula da coluna E (`PAGAMENTOS:` - azul suave `#E0F2FE`), mantendo as demais células da linha no padrão normal para não confundir o leitor com uma finalização da OS.
**Risco identificado:** A dependência de horários de wake/sleep de máquinas locais do usuário quebrava a entrega diária. A execução foi 100% migrada e encadeada no cron da VPS Linux (`15 3 * * * run-hydra-daily-full.sh && run-patio.sh`).
**Não fazer:**
- NUNCA configurar rotinas operacionais no Agendador de Tarefas do Windows local do usuário.
- NUNCA descontar pagamentos do dia do saldo `restanteERP`.
- NUNCA pintar a linha inteira de uma OS aberta quando ela apenas recebeu um pagamento parcial.

## [2026-10-08] — [Feature ID: hydra-patio-strict-payments-and-grand-total]
**Contexto:** Correção do critério temporal de detecção de pagamentos em D-1, eliminando falso positivo que importava parcelas futuras de cartão de crédito e pagamentos antigos de OSs que haviam sido editadas no ERP em D-1.
**Regra aprendida:**
1. **`historico_atualizado_em` Não é Data de Pagamento:** No Oficina Inteligente, o timestamp de atualização é auditado sempre que qualquer campo (status, checklist, anexo fotográfico) é modificado. Usá-lo para inferir que parcelas de crédito foram passadas ontem é um anti-pattern grave.
2. **Vencimento Estrito D-1:** Um pagamento pertence a ontem se e somente se sua data de vencimento/liquidação for estritamente igual à data de referência D-1 (`vencimentoBR === refDateBR`).
**Risco identificado:** Se o ERP alterar a nomenclatura do campo de vencimento ou omitir a data em vendas à vista, pagamentos poderiam ser descartados. A normalização com `normalizeToBRDate` garante consistência contra múltiplos formatos de data.
**Não fazer:**
- NUNCA inferir data de pagamento a partir do timestamp de modificação geral da OS (`historico_atualizado_em`).
- NUNCA trazer parcelas futuras de cartão para a conciliação diária de recebimentos de ontem.

## [2026-10-08] — [Feature ID: hydra-admin-group-and-settlement]
**Contexto:** Cadastro do novo administrador Joacir Barros (+55 11 94764-5967), integração do grupo WhatsApp Mecânica TI (120363425738307789@g.us) como canal de broadcast exclusivo para resumos diários e alertas de conversas dos gerentes (Watchdog), com trava de segurança de grupo (zero conversação interativa), cálculo de previsão de liquidação matinal D+1 e supressão total de planilhas Excel (.xlsx) nos envios para grupos.
**Regra aprendida:**
1. **Trava de Conversação em Grupos (Zero Interação):** Mensagens recebidas pelo webhook com JID terminado em `@g.us` devem ser rejeitadas no handshake com HTTP 200 `{"status": "ignored_group"}`, sem reação, sem status de digitação e sem despacho para LLM ou fila, garantindo que o bot nunca dialogue em grupos.
2. **Supressão de Planilhas em Grupos:** Grupos de WhatsApp corporativos devem receber estritamente o texto executivo e alertas de supervisão. Arquivos binários/documentos (.xlsx) são restritos aos números privados dos administradores/diretoria para não poluir o grupo nem expor anexos volumosos.
3. **Cálculo de Previsão de Liquidação Matinal D+1:** Débitos passados em D-1 liquidam em D+1 pela manhã. Somados ao Pix e Dinheiro já disponíveis, compõem a "Disponibilidade Imediata em Caixa (Manhã)", separando claramente o que cai hoje do faturamento a prazo (crédito).
**Risco identificado:** Enviar mensagens em grupos com o texto dizendo "Planilha detalhada em anexo" quando a planilha foi suprimida gera confusão. O gerador do resumo deve receber a flag `isGroup` e omitir menções a arquivos anexos.
**Não fazer:**
- NUNCA permitir que o bot processe comandos ou converse dentro de grupos de WhatsApp.
- NUNCA enviar arquivos de planilha Excel (.xlsx) para canais de grupo.
- NUNCA usar instâncias de gerentes como remetentes de notificações ou broadcasts.

## [2026-10-08] — [Feature ID: hydra-hermes-balloons-and-os-audit]
**Contexto:** Implementação de particionamento em balões nativos no WhatsApp via `---BLOCK---`, categorização semântica de peças e serviços por sistemas mecânicos, Title Case inteligente, hierarquização estrita de vistorias (inspeção de entrada subordinada ao checklist de entrada) e card de auditoria fática transparente do ERP quando não há conversas espelhadas no sistema central.
**Regra aprendida:**
1. **Particionamento em Balões Nativos via `---BLOCK---`:** Para evitar o botão `... Ler mais` no smartphone e garantir leitura escaneável, grandes relatórios (como a OS 360°) devem ser emitidos pelo composer delimitados por `\n\n---BLOCK---\n\n`. O dispatcher quebra nesses separadores e despacha balões independentes (<900 caracteres cada).
2. **Categorização Semântica por Conjuntos Mecânicos:** Listas de serviços e peças no WhatsApp tornam-se ilegíveis quando descarregadas em texto plano. Agrupar os itens por sistemas (⚡ Elétrica/Ignição, 🌡️ Arrefecimento, 🔩 Suspensão/Rodagem, 🛑 Freios, 📦 Revisão/Apoio) com subtotais e Title Case limpo reduz drasticamente o esforço cognitivo do operador. Placeholders do ERP (`Preencher Executor...`) devem ser sempre suprimidos.
3. **Hierarquia de Checklists no ERP:** O `Check-List de Inspeção` (feito na recepção do veículo) pertence conceitualmente ao processo de entrada e deve ser exibido imediatamente abaixo de `Checklist de Entrada`, antes de `Checklist do Mecânico`.
4. **Auditoria Transparente vs. Silêncio/Eco Nulo:** Ao ser questionado sobre histórico e conversas de uma OS cujo atendimento ocorreu fisicamente fora do sistema, o bot nunca deve ecoar uma linha vazia. Ele deve declarar a auditoria factual completa do ERP: quem abriu a OS, quem atualizou por último, se o campo de anotações está em branco, quais arquivos estão anexados e que o número de telefone não possui chats vinculados nos canais centrais.
**Não fazer:**
- NUNCA despachar uma lista longa de peças e serviços colada em um único balão gigante sem separadores.
- NUNCA posicionar o checklist de inspeção de entrada abaixo do checklist do mecânico.
- NUNCA repetir a mesma frase curta nula ao ser cobrado por histórico de conversa.

---

## [2026-10-09] — [Feature ID: hydra-evo-interactive-os]
**Contexto:** Substituição do envio maciço de múltiplos balões colados de OS por uma arquitetura interativa e modular de 3 etapas no WhatsApp via Evolution API v2.3.7 (`sendText` resumo executivo sóbrio -> `sendList` menu nativo de módulos -> `sendText` detalhamento modular sob demanda), com arquitetura híbrida (zero state-lockout), regra contábil rigorosa de pagamento e tolerância a dados parciais.
**Regra aprendida:**
1. **Contrato Obrigatório de `sendList` na Evolution API v2.3.7:** O endpoint `POST /message/sendList/${INSTANCE}` exige compulsoriamente os campos `number`, `title`, `description`, `buttonText`, `footerText` e `sections` com `rows` contendo `title`, `description` e `rowId`. A omissão de `footerText` resulta em HTTP 400. Cada `rowId` deve seguir formato seguro e validado (`os_{id}_{modulo}`).
2. **Ingress de Seleções da Evolution API:** No webhook de entrada (`messages.upsert`), cliques em linhas de lista trafegam prioritariamente em `messageObj.listResponseMessage.singleSelectReply.selectedRowId`. O listener deve inspecioná-lo antes de `conversation` ou `extendedTextMessage`.
3. **Arquitetura 100% Híbrida (Zero State-Lockout):** Listas interativas convivem em perfeita simbiose com comandos de texto normalizados (`SERVICOS 18503`, `pecas`, `pagamentos`, `documentos`, `historico`) e perguntas livres em linguagem natural ("quanto Mauá faturou hoje?", "o cliente aprovou o orçamento?"). Nunca implementar máquina de estados restritiva (URA) que trave o usuário com "opção inválida".
4. **Regra Contábil de "Pago":** O valor pago é calculado estritamente como `Pago = Total da OS - Saldo Devedor` (amortizações efetivas já liquidadas). Parcelas futuras ou a vencer cadastradas no ERP não devem ser computadas no montante pago.
5. **Anti-Slop & Zero Emojis em Relatórios de OS:** Proibição de emojis (`⚡`, `🌡️`, `🔩`, `🛑`, etc.) e eliminação de placeholders do ERP (`Preencher Executor...`). Utilizar apenas negrito do WhatsApp, traços, indentação e números contábeis claros.
6. **Segurança Crítica de Mensageria:** Trava de emissão estrita: apenas instâncias `hydra` e `atendimento` podem enviar listas (`sendWhatsAppList`) e mensagens. Instâncias de gerentes são bloqueadas incondicionalmente.
**Risco identificado:** Enviar mensagens de lista sem `footerText` ou com instâncias não conectadas causa falha de entrega na Evolution API.
**Não fazer:**
- NUNCA omitir o campo `footerText` no payload de `sendList` na Evolution API v2.3.7.
- NUNCA travar a conversa com menus rígidos que bloqueiam perguntas livres em linguagem natural.
- NUNCA somar parcelas a vencer como valor já pago pelo cliente.
- NUNCA usar emojis em relatórios executivos de OS.
- NUNCA usar aparelhos/instâncias de gerentes para envio de listas ou mensagens interativas.

---

## [2026-10-09] — [Feature ID: hydra-patio-piraporinha-stale-fix]
**Contexto:** Correção e blindagem de resiliência após discrepância de conciliação de OSs em Piraporinha causada por timeout transiente de ASP.NET WebForms (`#lblSiglaEmpresa`) na virada de loja, que acionou o Circuit Breaker e preservou o snapshot do dia anterior (24h obsoleto), gerando relatório matinal com dados desatualizados.
**Regra aprendida:**
1. **Active Recovery em WebForms ASP.NET (`ensureCompany`):** Em trocas sequenciais de empresa, timeouts no seletor `#lblSiglaEmpresa` não devem falhar cegamente em loop fechado sem intervenção de rede. Se a página cair em `Default.aspx` ou login, re-autenticar imediatamente; caso contrário, forçar `page.reload({ waitUntil: 'load' })` para purgar modais/overlays travados e estender o timeout para 12s.
2. **Recovery Pass (Auto-Healing) no Crawler Diário:** Preservar snapshots anteriores em caso de falha transitória é essencial para contingência, mas o ciclo diário não pode encerrar sem uma segunda passada de recuperação. O `deep-crawler.ts` deve enfileirar as lojas com erro de OS (`lojasComFalhaOS`) e tentar a extração cirúrgica de recuperação após a etapa de CMV antes de consolidar os dados. Se alguma loja continuar pendente após a retentativa, o processo deve falhar com código de erro explícito.
3. **Freshness Guard no Pátio Ledger (`validateStoresFreshness`):** O adaptador de ingestão matinal (`patio_hydra_bot_adapter.js`) nunca deve confiar que um arquivo `os_store_<slug>.json` é válido apenas porque seu tamanho é maior que 1KB. Ele deve auditar o mtime e o campo `ultima_atualizacao` interno contra a tolerância máxima (12 horas). Se houver lojas obsoletas em execução de produção, o relatório deve ser bloqueado com alerta determinístico para o time de desenvolvimento.
**Risco identificado:** Execuções automáticas continuarem consumindo caches antigos em disco quando o crawler primário falha silenciosamente, transmitindo falsos positivos na conciliação financeira da diretoria.
**Não fazer:**
- NUNCA assumir que um arquivo JSON local é fresco apenas pelo tamanho em bytes sem verificar `mtime` e `ultima_atualizacao`.
- NUNCA tentar retentativas de seletores ASP.NET sem recarregar a página (`page.reload`) quando houver travamento de ViewState ou modais fantasmas.
- NUNCA permitir que o ciclo unificado encerre com status `SUCCESS` se alguma loja tiver ficado sem extração recente de OS.



