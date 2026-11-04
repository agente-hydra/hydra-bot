# Spec 062: Fast-Path Determinístico de Tempário, Extração de Serviços Multi-Token, Resolução por Placa e Deploy na VPS

**Status:** PROPOSTA — AGUARDANDO APROVAÇÃO (`/sdd-apply`)
**Data:** 2026-11-03
**Autor:** Antigravity Agent (Evidence-Before-Mutation)

---

## 1. Diagnóstico Forense Completo (Por que falhou às 16:18, 16:23 e 16:24)

A auditoria forense dos logs reais na VPS (`/home/operacional/hydra-data/hydra_ops.db` -> `agent_interaction_logs` #1416, #1417 e #1418 + transcript do cérebro AGY `a5c2e701-f4fa-4dcc-a519-a2ced310cc3a` Steps 24 a 60) e do código-fonte revelou **6 elos quebrados** entre a mensagem do WhatsApp e o motor do Tempário:

### 1.1. O Rastro Real dos 3 Turnos na VPS (`operacional@100.126.50.101`)
1. **Ausência do Tempário na VPS (`/home/operacional/hydra/`):**
   - Os módulos das Specs 054 e 061 (`tempario_graph_repository.ts`, `tempario_hybrid_coordinator.ts`, `tempario_web_researcher.ts`) estavam apenas na máquina local Windows (retidos pelo *Hard Stop* do SDD) e **ainda não haviam sido sincronizados** para `/home/operacional/hydra/src/hydra-sync/` na VPS onde o daemon `hydra-bot` (PID 2454) escuta o webhook do WhatsApp.

2. **Turno 1 — 16:18:59 (`agent_interaction_logs.id = 1416` | Latência: `90.517 ms` | Motor: `FALLBACK_API`):**
   - **Entrada:** `"Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?"`
   - **Roteamento:** Sem `isTemparioTechnicalQuery` na VPS, o `intent_rewriter.ts` classificou como `intent: "other"` e enviou para o subprocesso `AGY_PRIMARY` (conversa `a5c2e701-f4fa-4dcc-a519-a2ced310cc3a`).
   - **O que o AGY CLI fez durante 90 segundos (Steps 25 a 54 do transcript):**
     - **Step 25 (16:19:04):** Rodou `find /opt/bots -maxdepth 3 -name "*tabela*" -o -name "*servico*" -o -name "*tempo*"` tentando achar alguma tabela de preços/tempos no disco.
     - **Step 27–29 (16:19:08–16:19:21):** Rodou `grep -i "golf" /opt/bots/downloads/*.json`, que travou em background (`task-28`) e precisou ser cancelado (`kill`).
     - **Step 38–41 (16:19:32–16:19:50):** Chamou a tool MCP `search_os({"termo": "Golf"})` tentando descobrir quanto cobraram em OSs antigas de Golf. Encontrou a OS #429 (`MPJabaquara`, Placa `EMN3F05`, troca de sensor de nível/bico) e a OS #672 (`MPdompedro1`, Placa `FOE6I25`), nenhuma com farol ou radiador.
     - **Step 42–53 (16:19:50–16:20:12):** Chamou `execute_readonly_sql` procurando `WHERE raw_payload LIKE '%RADIADOR%' AND veiculo LIKE '%GOLF%'` (retornou `[]`) e depois `LIKE '%RADIADOR%'` geral (achou apenas aditivo de radiador num Kwid OS #434).
     - **Step 54 (16:20:12):** Quando começou a escrever `*HYDRA | Estimativa Técnica e Mão de Obra | Golf 1.4 TSI*\n\n> *Vis`, o timeout de **90.000 ms** do `dual_worker_router` estourou, matou o processo (`SIGTERM`) e acionou o fallback determinístico (`FALLBACK_API`).
     - **Saída do Fallback:** O `executeOperationalQuery` buscou uma OS aberta para os filtros da frase, não achou e devolveu:
       `> *Aviso Operacional*\nNão encontrei nenhuma ordem de serviço aberta para os parâmetros informados.`

3. **Turno 2 — 16:23:46 (`agent_interaction_logs.id = 1417` | Latência: `8.109 ms` | Motor: `AGY_PRIMARY`):**
   - **Entrada:** `"nao ofi isso que pedi pra vc."`
   - **Step 55–57:** O AGY CLI recebeu a notificação de sistema de que a execução anterior havia sido interrompida (`All your subagents and background tasks have been stopped due to server restart`) e respondeu pedindo para reenviar em uma linha.

4. **Turno 3 — 16:24:05 (`agent_interaction_logs.id = 1418` | Latência: `9.946 ms` | Motor: `AGY_PRIMARY`):**
   - **Entrada:** `"Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?"`
   - **Step 58–60:** Como a sessão `a5c2e701-f4fa-4dcc-a519-a2ced310cc3a` já tinha no contexto (Steps 38–53) que o banco não possuía tabela de tempário nem OS de Golf com radiador/farol, o LLM respondeu direto da memória interna do modelo (**alucinação sem tempário**):
     - Chutou `4 a 6 horas de trabalho` (em vez de **3,05h líquidas / 3,80h brutas** do grafo);
     - Chutou `R$ 600,00 a R$ 900,00` (em vez de **R$ 823,50 cravados à taxa de R$ 270,00/h** da rede);
     - Omitiu as **6 peças obrigatórias/preventivas** e as **12 ferramentas e torques**.

---

### 1.2. Os 5 Bugs Estruturais no Código Local que Impediriam o Fluxo End-to-End Natural

Mesmo que os arquivos locais tivessem sido copiados para a VPS, a inspeção do código em `src/hydra-sync/` revelou 5 falhas no encadeamento de mensagem natural:

1. **Falta de Extração Atomizada de Serviços em `intent_rewriter.ts` (Linha 1478):**
   - `intent_rewriter.ts` passava a frase inteira como um único termo: `serviceTerms: [textoLimpo]` (`["Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?"]`).
   - Em `tempario_hybrid_coordinator.ts` (Linha 164), a query `WHERE LOWER(titulo) LIKE '%golf 1.4 tsi quanto tempo...%'` retorna **0 linhas**, pois o título da operação é `'Substituição do Farol Dianteiro Esquerdo'` e `'Substituição do Radiador de Arrefecimento'`.

2. **Operador `AND` Rígido com Stopwords no FTS5 em `tempario_vector.ts` (Linha 138):**
   - `searchTemparioHybridRRF` chamava `escapeFtsQuery(rawQuery)` (`hybrid_retrieval.ts:160`), que converte a frase inteira em `"Golf"* AND "quanto"* AND "tempo"* AND "valor"* AND "farol"* AND "radiador"*`.
   - Como nenhum chunk técnico contém palavras conversacionais (`"quanto"`, `"pra"`, `"valor"`) e os chunks de Farol e Radiador são registros separados, o `MATCH` com `AND` retorna **0 resultados** para perguntas naturais com múltiplos serviços!

3. **Ausência de Fast-Path Determinístico em `agent_dispatcher.ts`:**
   - Enquanto `runtime_diagnostics`, `conversation_history` e `memory_preference` possuem retorno imediato determinístico antes do `hydraDualRouter` (Linhas 948–1226), `TEMPARIO_TEMPO_SERVICO` caía no `hydraDualRouter` (subindo o processo pesado do `agy` CLI de 15s–90s) em vez de resolver deterministicamente via `TemparioHybridCoordinator` + `composeTemparioHermesBalloon` em **< 50ms**!

4. **Sequestro de `intent.veiculo` em `operational_adapter.ts` (Linha 1060):**
   - Em `_executeOperationalQueryCore`, não havia tratamento para `intent.intent === 'TEMPARIO_TEMPO_SERVICO'`. Como `intent.veiculo` estava preenchido (`"Golf"`), a execução caía na Linha 1060 (`// 2. Consulta de Permanência no Pátio por Modelo de Veículo`) e devolvia `> *Veículo Não Localizado*` se não houvesse um Golf aberto no pátio!

5. **Resolução de Veículo por Placa ou OS em Consultas de Tempário:**
   - Quando o operador informa uma placa real do pátio (ex: `FOE6I25 quanto tempo e mão de obra pra trocar farol e radiador?` — onde `FOE6I25` é o `GOLF` da OS #672 na `MPdompedro1`) ou número de OS, o sistema precisa consultar `ordens_servico` primeiro para descobrir que `FOE6I25` = `GOLF`, e em seguida rodar o Tempário Híbrido para o `GOLF`.

---

## 2. Solução Proposta

1. **Extrator Canônico de Componentes e Serviços Mecânicos (`extractTemparioServiceTokens`):**
   - Extrair tokens mecânicos reais da mensagem (`farol`, `radiador`, `correia`, `bomba`, `embreagem`, `retentor`, `volante`, `pastilha`, `disco`, `freio`, `amortecedor`, `coxim`, `batente`, `suspensao`, `turbina`, `alternador`, `vela`, `bico`, `oleo`, `filtro`, etc.) e popular `serviceTerms: string[]` com os componentes individuais (ex: `['farol', 'radiador']`).
   - Suportar também resolução de veículo completo (`Golf 1.4 TSI`, `Onix 1.0 Turbo`, `Civic 2.0`, `Corolla 2.0`, `Renegade 1.3 Turbo`, `Tracker 1.2 Turbo`, etc.) e motor (`1.4 TSI`, `1.0 Turbo`, `2.0`, `1.3 Turbo`, `1.2 Turbo`).

2. **Busca FTS5 Multi-Componente Tolerante (`buildTemparioFtsQuery`) em `tempario_vector.ts`:**
   - Filtrar stopwords conversacionais (`quanto`, `tempo`, `valor`, `mao`, `obra`, `pra`, `para`, `trocar`, `troca`, `fazer`, `custa`, `cobrar`, `horas`, `servico`) e unir os termos técnicos relevantes com `OR` no FTS5 (`"farol"* OR "radiador"*`), permitindo recuperar simultaneamente os chunks de **ambas** as operações para que o grafo faça a deduplicação associativa!

3. **Resolução Híbrida Placa/OS -> Veículo (`resolveVehicleFromPlateOrOsForTempario`):**
   - Se a pergunta de tempário contiver uma placa (ex: `FOE6I25`, `EMN3F05`) ou número de OS, buscar em `ordens_servico` o campo `veiculo` e `loja_slug` daquela placa/OS antes de chamar `TemparioHybridCoordinator.coordinateQuery`.

4. **Fast-Path Determinístico em `agent_dispatcher.ts` e `operational_adapter.ts`:**
   - Em `agent_dispatcher.ts` (logo após os blocos 3.0.x e também antes do AI Reviewer de gerente, respeitando o isolamento de loja `authorizedLojaSlug` do gerente!) e em `operational_adapter.ts` (no topo de `_executeOperationalQueryCore`, antes de `if (intent.veiculo)`):
     - Quando `canonical.intent === 'TEMPARIO_TEMPO_SERVICO'` ou `isTemparioTechnicalQuery(textoLimpo)`:
     - Garantir inicialização idempotente do catálogo (`ensureTemparioTables(db)` + `seedCanonicalTemparioCatalog(db)`);
     - Executar `coordinator.coordinateQuery(...)`;
     - Formatar com `composeTemparioHermesBalloon(response)` + `validateAndSanitizePublicResponse`;
     - Persistir logs e estado do turno e retornar em **< 50ms** (catálogo) ou **< 3.000ms** (web search real).

5. **Sincronização, Seed e Validação End-to-End na VPS (`/home/operacional/hydra/`):**
   - Sincronizar os arquivos atualizados de `src/hydra-sync/` para `/home/operacional/hydra/src/hydra-sync/` e `/home/operacional/hydra-deploy/current/src/hydra-sync/` na VPS (`operacional@100.126.50.101`).
   - Executar seed idempotente do catálogo canônico diretamente no banco de produção `/home/operacional/hydra-data/hydra_ops.db`.
   - Reiniciar `hydra-bot` no PM2 com verificação `node --check` / `tsx` e validar `dispatchTurn` real contra `/home/operacional/hydra-data/hydra_ops.db` tanto por modelo (`"Golf 1.4 TSI quanto tempo e valor de mão de obra pra trocar farol e radiador?"`) quanto pelas placas reais de Golf do banco (`"FOE6I25 quanto tempo e valor de mão de obra pra trocar farol e radiador?"`).

---

## 3. Riscos e Mitigações

- **Risco Principal:** Colisão entre perguntas de status de OS ("o Golf já trocou o farol?") e perguntas de orçamento/tempário ("quanto tempo e valor de mão de obra pra trocar farol e radiador do Golf?").
- **Mitigação:** `isTemparioTechnicalQuery` exige explicitamente marcadores de consulta de tempo/orçamento (`quanto tempo`, `quantas horas`, `tempo pra`, `valor de mão de obra`, `mão de obra pra`, `tempário`, `quanto cobrar na mão de obra`) combinados com ação/componente mecânico, preservando intactas as consultas de status de OS.
