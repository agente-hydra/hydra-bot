# Proposta SDD — Atualização dos Dados do Hydra (Crawlers & Ingestão Operacional)

> **ID da Spec:** `hydra-data-crawlers`  
> **Status:** PROPOSTA / HARD STOP  
> **Data:** 2026-09-30  
> **Base Integrada:** Commit `bd26c7f` (`codex/manager-store-scope` em `hydra-staging`) e PM2 `hydra-bot` em produção  
> **Referência de Revisão:** Branch `codex/hourly-crawler` (protótipo na VPS, estritamente como base de consulta)  

---

## 1. Problema e Diagnóstico

O ecossistema conversacional e analítico do Hydra atingiu alta maturidade (Frentes A, B e C integradas, reações 👀/✅ funcionais e 389 testes passando). Contudo, a base de dados subjacente no SQLite (`hydra_ops.db`) sofre de assimetria de atualização:

1. **CMV Incompleto por Loja:** O crawler diário de OSs nem sempre consolidava na mesma passada os relatórios de operação de todas as 10 lojas operacionais (`faturamento_areas`, `pesquisa_midia` e `cmv_lojas`), gerando lacunas onde apenas parte da rede possuía CMV apurado.
2. **Ausência de Vendas do Dia Oficiais:** O Hydra não dispunha de uma ingestão horária da fonte oficial **Vendas por Dia** (`wfRelatorioOperacao.aspx` -> botão de exportação diária). Tentativas de subtrair acumulados mensais geram distorções contábeis graves (cancelamentos, reaberturas e emissões retroativas invalidam o cálculo por delta).
3. **Metas Horárias sem Rastreio Temporal:** O Mapa de Metas precisa ser amostrado a cada hora em tabela histórica (`metas_horarias`), preservando a evolução de faturamento acumulado, ticket e meta ao longo do mês.
4. **Risco de Concorrência de Sessão no ERP:** O sistema web Oficina Inteligente invalida sessões simultâneas se um crawler diário e um crawler horário executarem ao mesmo tempo com o mesmo usuário. Um **lock compartilhado (flock)** é indispensável.
5. **Regra de Ouro Inegociável:** As coletas de dados devem **EXCLUSIVAMENTE salvar dados no banco**, sem jamais disparar mensagens ativas ou notificações no WhatsApp. A loja administrativa `MPMaster` é estritamente excluída das 10 lojas operacionais.

---

## 2. Divisão de Responsabilidades e Modelo de Delegação

A execução será distribuída em 3 frentes com isolamento estrito de arquivos e branches em worktrees dedicadas, sem riscos de conflitos:

```
                                  ┌─────────────────────────────┐
                                  │   AGENTE PRINCIPAL          │
                                  │   (Orquestrador/Integrador) │
                                  └──────────────┬──────────────┘
                                                 │
          ┌──────────────────────────────────────┼──────────────────────────────────────┐
          ▼                                      ▼                                      ▼
┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
│   AGENTE 1                │  │   AGENTE 2                │  │   AGENTE 3                │
│   Ciclo OS → CMV por Loja │  │   Finanças Horárias       │  │   Persistência, Locks     │
│   (Diário / Operação)     │  │   (Metas + Vendas do Dia) │  │   Frescor e Harness       │
├───────────────────────────┤  ├───────────────────────────┤  ├───────────────────────────┤
│ • deep-crawler.ts         │  │ • metas_crawler.ts        │  │ • finance_snapshot_repo.ts│
│ • relatorio_operacao_     │  │ • hourly_finance_worker.ts│  │ • data_worker_log.ts      │
│   crawler.ts              │  │ • Vendas por Dia oficial  │  │ • Scripts shell (flock)   │
│ • 10/10 lojas sequencial  │  │ • America/Sao_Paulo       │  │ • Test Harness Integrado  │
│ • Sem pular lojas         │  │ • Upsert idempotente      │  │ • Detecção de Stale Data  │
└───────────────────────────┘  └───────────────────────────┘  └───────────────────────────┘
```

---

## 3. Catálogo Oficial das 10 Lojas Operacionais

O `CATALOGO_10_LOJAS` oficial (extraído de `db_repository.ts`) compõe o universo estrito de extração:
1. `MPdompedro1` (Dom Pedro)
2. `MPJabaquara` (Jabaquara)
3. `MPJorgeBeretta` (Jorge Beretta)
4. `MPkennedy` (Kennedy)
5. `MPpiraporinha` (Piraporinha)
6. `MPplanalto` (Planalto)
7. `MPrudge` (Rudge Ramos)
8. `MPSantoAndre` (Santo André)
9. `ReiDoModulo` (Rei do Módulo)
10. `ReiDoOleoMaua` (Rei do Óleo Mauá)

> **Exclusão Absoluta:** `MPMaster` é loja de cadastro administrativo e suporte. Nunca entra no cálculo de CMV da rede, nem nas vendas do dia ou metas operacionais.

---

## 4. Prompts Calibrados para Cada Subagente

### Prompt Calibrado — Agente 1 (Ciclo OS → CMV por Loja)

```markdown
Você é o Agente 1 (Especialista em Crawlers Operacionais, Ingestão de OS e Relatório de Operação).
Sua missão é implementar o ciclo unificado e sequencial Loja a Loja (OS → Gestão Periódica / CMV) na VPS operacional (operacional@100.126.50.101).
Acesso via SSH: ssh -o BatchMode=yes -o StrictHostKeyChecking=no operacional@100.126.50.101 "<comando>"

REGRAS CRÍTICAS E INEGOCIÁVEIS:
- Você trabalha EXCLUSIVAMENTE no worktree /home/operacional/hydra-agent1-cmv na branch feat/data-agent1-os-cmv criada a partir de bd26c7f.
- NUNCA altere ou edite /opt/bots/webhook-listener.js, /home/operacional/hydra/webhook-listener.js ou arquivos do bot conversacional.
- NUNCA envie mensagens no WhatsApp. Os crawlers apenas salvam dados no SQLite / arquivos de snapshot.
- A loja administrativa MPMaster NUNCA entra na lista de 10 lojas operacionais.
- Base de consulta permitida: inspecione a branch codex/hourly-crawler como referência de código, mas crie sua implementação limpa e testada.

ARQUIVOS SOB SUA RESPONSABILIDADE:
- src/hydra-sync/deep-crawler.ts
- src/hydra-sync/relatorio_operacao_crawler.ts
- src/hydra-sync/tests/test_agent1_crawler_operacao.ts

TAREFAS DETALHADAS:
1. Em src/hydra-sync/relatorio_operacao_crawler.ts:
   - Configurar o catálogo estrito das 10 lojas operacionais (EMPRESAS_RELATORIO excluindo MPMaster).
   - Para uma dada loja: selecionar e confirmar a empresa via ensureCompany(page, slug).
   - Navegar até wfRelatorioOperacao.aspx, clicar no botão Gestão Periódica (#ctl00_cph_btnGestaoPeriodica) e aguardar o carregamento da grid #ctl00_cph_grdFaturamentoPorArea.
   - Extrair faturamento_areas (área, faturamento, desconto, custo, cmv_percentual, lucro_bruto).
   - Extrair pesquisa_midia (canal, faturamento, qtd_os, ticket_medio).
   - Extrair cmv_lojas da linha totalizadora oficial com cmv_percentual do sistema.
   - Validações de integridade obrigatórias antes de persistir:
     * faturamento_total e cmv_percentual devem ser finitos e positivos.
     * Somatório do faturamento das áreas deve bater com faturamento_total do totalizador (tolerância de R$ 1,00 para arredondamento).
     * Distinguir claramente "sem vendas no período" (linhas zeradas legítimas) de "falha na extração" (grid ausente ou erro de DOM).
     * NUNCA sobrescrever um snapshot válido existente por tabela vazia decorrente de falha de navegação.
   - Salvar via salvarRelatorioOperacao(db, ...).
2. Em src/hydra-sync/deep-crawler.ts:
   - Ajustar o fluxo principal para que seja estritamente SEQUENCIAL POR LOJA:
     Para cada uma das 10 lojas:
       a) Trocar para a empresa e confirmar (ensureCompany).
       b) Concluir a coleta e persistência de OSs da loja (salvarLoteOSs + embeddings).
       c) Imediatamente na mesma sessão, abrir Gestão Periódica em wfRelatorioOperacao.aspx, extrair CMV, Áreas e Mídia e salvar no SQLite.
       d) Só então avançar para a próxima loja.
   - Circuit Breaker: se a coleta de OS ou CMV falhar em uma loja, registrar a falha em hydra_data_worker_runs (ou log estruturado), preservar o snapshot anterior e CONTINUAR para as demais lojas (sem abortar o loop geral).
   - Ao final, registrar o status consolidado do ciclo diário (sucesso total 10/10 ou incompleto com lista de lojas pendentes).
3. Criar e executar a suíte de testes em src/hydra-sync/tests/test_agent1_crawler_operacao.ts:
   - Teste de troca de empresa e confirmação para as 10 lojas elegíveis (excluindo MPMaster).
   - Teste de extração e validação matemática de faturamento_areas e linha totalizadora de CMV.
   - Teste de falha intermediária: se uma loja falhar, as outras continuam e o snapshot anterior da loja com falha permanece intacto.
   - Teste de idempotência: rodar duas vezes consecutivas não duplica linhas nem corrompe totais.
   - Executar com: npx tsx src/hydra-sync/tests/test_agent1_crawler_operacao.ts (100% PASS).
4. Commitar na branch feat/data-agent1-os-cmv:
   git add . && git commit -m "feat(crawler): sequential per-store OS and CMV operation report cycle for 10 stores"
5. Gerar arquivo de patch:
   git diff bd26c7f > /home/operacional/patch-agent1-crawler-operacao.diff
6. Reportar ao Integrador: commit hash, testes aprovados, resumo das alterações e caminho do patch.
```

---

### Prompt Calibrado — Agente 2 (Atualização Horária de Faturamento e Metas)

```markdown
Você é o Agente 2 (Especialista em Coleta Financeira, Mapa de Metas e Ingestão de Vendas do Dia).
Sua missão é implementar a rotina de coleta financeira horária das 10 lojas operacionais na VPS operacional (operacional@100.126.50.101).
Acesso via SSH: ssh -o BatchMode=yes -o StrictHostKeyChecking=no operacional@100.126.50.101 "<comando>"

REGRAS CRÍTICAS E INEGOCIÁVEIS:
- Você trabalha EXCLUSIVAMENTE no worktree /home/operacional/hydra-agent2-finance na branch feat/data-agent2-metas-vendasdia criada a partir de bd26c7f.
- NUNCA altere ou edite /opt/bots/webhook-listener.js, /home/operacional/hydra/webhook-listener.js ou arquivos do bot conversacional.
- NUNCA envie mensagens no WhatsApp. Esta rotina é estritamente para salvar métricas financeiras no SQLite.
- A loja administrativa MPMaster NUNCA entra na lista de 10 lojas operacionais.
- Base de consulta permitida: inspecione a branch codex/hourly-crawler como referência de código, mas crie sua implementação limpa e testada.

ARQUIVOS SOB SUA RESPONSABILIDADE:
- src/hydra-sync/metas_crawler.ts
- src/hydra-sync/hourly_finance_worker.ts
- src/hydra-sync/tests/test_agent2_finance_worker.ts

TAREFAS DETALHADAS:
1. Em src/hydra-sync/metas_crawler.ts:
   - Garantir que o crawler do Mapa de Metas ignore MPMaster e colete as 10 lojas operacionais.
   - Validar integridade com validarIntegridadeMetas(metas): rejeitar capturas com menos de 10 lojas ou com valores corrompidos.
2. Em src/hydra-sync/hourly_finance_worker.ts:
   - Implementar a tabela metas_horarias:
     (data_referencia TEXT, posicao_hora TEXT, loja_slug TEXT, faturamento_mes REAL, volume_os INTEGER, ticket_medio REAL, meta_mes REAL, previsao_mes REAL, percentual_meta REAL, captured_at TEXT, PRIMARY KEY(data_referencia, posicao_hora, loja_slug)).
   - Implementar a tabela faturamento_diario_horario:
     (data_referencia TEXT, posicao_hora TEXT, loja_slug TEXT, faturamento_dia REAL, volume_os_dia INTEGER, captured_at TEXT, fonte TEXT DEFAULT 'VENDAS_POR_DIA_OFICIAL', PRIMARY KEY(data_referencia, posicao_hora, loja_slug)).
   - Timezone estrito America/Sao_Paulo para day (YYYY-MM-DD) e hour (HH), inclusive na virada de dia e mês.
   - Extração oficial de VENDAS POR DIA:
     * Navegar até wfRelatorioOperacao.aspx para cada loja (usando ensureCompany).
     * Preencher txtDataInicial e txtDataFinal com a data de hoje (DD/MM/YYYY).
     * Selecionar formato Excel (ctl00_cph_rblFormato_1) e disparar o download via ctl00_cph_btnVendasPorDia.
     * Ler o arquivo Excel gerado via xlsx; localizar linha TOTAL e extrair faturamento_dia e volume_os_dia com precisão decimal.
     * PROIBIDO: calcular vendas de hoje por subtração de dois snapshots mensais.
     * Loja com 0 vendas confirmado pelo relatório deve gravar faturamento_dia = 0 e volume_os_dia = 0. Falha na exportação deve ser tratada como erro/ausente, sem gravar zero arbitrário.
   - Upsert idempotente por (data_referencia, posicao_hora, loja_slug).
   - Registrar cada coleta em hydra_data_worker_runs (kind = 'VENDAS_DIA').
3. Criar e executar a suíte de testes em src/hydra-sync/tests/test_agent2_finance_worker.ts:
   - Teste de parsing e validação de planilha Vendas por Dia (com totalizadores reais e simulados).
   - Teste de timezone America/Sao_Paulo na virada de dia/mês.
   - Teste de idempotência em metas_horarias e faturamento_diario_horario (repetição da mesma hora atualiza sem duplicar).
   - Teste de tolerância a falha parcial (se 1 loja falhar no download, as outras 9 são salvas e a falha é registrada).
   - Executar com: npx tsx src/hydra-sync/tests/test_agent2_finance_worker.ts (100% PASS).
4. Commitar na branch feat/data-agent2-metas-vendasdia:
   git add . && git commit -m "feat(finance): hourly metas and official daily sales worker for 10 stores"
5. Gerar arquivo de patch:
   git diff bd26c7f > /home/operacional/patch-agent2-finance-worker.diff
6. Reportar ao Integrador: commit hash, testes aprovados, resumo das alterações e caminho do patch.
```

---

### Prompt Calibrado — Agente 3 (Persistência, Frescor, Agendamento e Harness)

```markdown
Você é o Agente 3 (Especialista em Persistência, Concorrência de Locks, Observabilidade e Test Harness).
Sua missão é implementar a camada estável de consulta de snapshots, detecção de dado desatualizado (stale), scripts de agendamento com flock compartilhado e suíte de validação na VPS operacional (operacional@100.126.50.101).
Acesso via SSH: ssh -o BatchMode=yes -o StrictHostKeyChecking=no operacional@100.126.50.101 "<comando>"

REGRAS CRÍTICAS E INEGOCIÁVEIS:
- Você trabalha EXCLUSIVAMENTE no worktree /home/operacional/hydra-agent3-harness na branch feat/data-agent3-persistence-harness criada a partir de bd26c7f.
- NUNCA altere ou edite /opt/bots/webhook-listener.js, /home/operacional/hydra/webhook-listener.js ou prompts conversacionais.
- Exponha funções de consulta desacopladas e estáveis para que o Agente Principal faça a ligação com o bot sem acoplamento.
- Base de consulta permitida: inspecione a branch codex/hourly-crawler como referência de código, mas crie sua implementação limpa e testada.

ARQUIVOS SOB SUA RESPONSABILIDADE:
- src/hydra-sync/finance_snapshot_repository.ts
- src/hydra-sync/data_worker_log.ts
- scripts/run-hydra-daily-full.sh
- scripts/run-hydra-hourly-finance.sh
- src/hydra-sync/tests/test_agent3_persistence_harness.ts

TAREFAS DETALHADAS:
1. Em src/hydra-sync/finance_snapshot_repository.ts:
   - Implementar funções de consulta do último snapshot válido:
     * getLatestDailyRevenue(db, dataReferencia, lojaSlug?, maxAgeMinutes = 120): retorna faturamento_dia, volume_os_dia, posicaoHora, capturedAt, isStale, staleMinutes.
     * getLatestMetasSnapshot(db, dataReferencia, lojaSlug?, maxAgeMinutes = 120): retorna faturamento_mes, volume_os, meta_mes, percentual_meta, capturedAt, isStale.
     * getLatestCMVSnapshot(db, dataInicio, dataFim, lojaSlug?): retorna dados consolidados de cmv_lojas e faturamento_areas com captured_at e status de completude (10/10 lojas ou lista de faltantes).
   - NUNCA retornar silenciosamente dados de outro mês quando a pergunta for sobre hoje.
2. Em src/hydra-sync/data_worker_log.ts:
   - Tabela hydra_data_worker_runs: id, kind ('OPERACAO' | 'VENDAS_DIA' | 'METAS'), loja_slug, data_referencia, started_at, finished_at, status ('SUCCESS' | 'ERROR'), item_count, error.
   - Função recordDataWorkerRun(db, args).
   - Função getRecentWorkerRuns(db, kind?, limit = 20) para observabilidade operacional. Proibido registrar dados sensíveis ou senhas nos erros.
3. Em scripts/run-hydra-daily-full.sh e scripts/run-hydra-hourly-finance.sh:
   - Configurar LOCK COMPARTILHADO usando flock no arquivo /tmp/hydra-data-refresh.lock.
   - Script diário (run-hydra-daily-full.sh):
     * Adquire flock exclusivo não bloqueante (flock -n 9) ou aguarda término. Se já houver execução em andamento, registra log e sai ou aguarda de forma controlada.
     * Executa com timeout de 55m /usr/bin/node /opt/bots/node_modules/tsx/dist/cli.mjs src/hydra-sync/deep-crawler.ts.
   - Script horário (run-hydra-hourly-finance.sh):
     * Aguarda o lock compartilhado por até 3600 segundos (flock -w 3600 9) caso o crawler diário esteja ativo. Assim que o lock for liberado, executa imediatamente o refresh financeiro sem conflito de sessão.
     * Executa com timeout de 20m /usr/bin/node /opt/bots/node_modules/tsx/dist/cli.mjs src/hydra-sync/hourly_finance_worker.ts.
4. Criar e executar o harness completo em src/hydra-sync/tests/test_agent3_persistence_harness.ts:
   - Teste de integridade de snapshot para 10/10 lojas operacionais.
   - Teste de concorrência e respeito ao flock compartilhado (/tmp/hydra-data-refresh.lock) simulando dois processos concorrentes.
   - Teste de detecção de dado desatualizado (isStale = true quando capturedAt > maxAgeMinutes).
   - Teste de distinção entre faturamento mensal (acumulado) vs faturamento de hoje (diário oficial).
   - Teste de observabilidade em hydra_data_worker_runs.
   - Executar com: npx tsx src/hydra-sync/tests/test_agent3_persistence_harness.ts (100% PASS).
5. Commitar na branch feat/data-agent3-persistence-harness:
   git add . && git commit -m "feat(harness): snapshot persistence, shared flock lock, worker logs and test harness"
6. Gerar arquivo de patch:
   git diff bd26c7f > /home/operacional/patch-agent3-persistence-harness.diff
7. Reportar ao Integrador: commit hash, testes aprovados, resumo das alterações e caminho do patch.
```

---

## 5. Papel e Checklist Exclusivo do Agente Principal (Integrador)

O Agente Principal **NÃO** programa diretamente nos worktrees durante a fase das frentes. Após o recebimento dos patches e confirmação dos testes dos subagentes:

1. **Revisão e Aplicação dos Patches em Staging (`hydra-staging`):**
   - Aplicar `patch-agent1-crawler-operacao.diff`.
   - Aplicar `patch-agent2-finance-worker.diff`.
   - Aplicar `patch-agent3-persistence-harness.diff`.
   - Resolver quaisquer desvios de tipagem com `npx tsc --noEmit`.
2. **Conexão dos Snapshots ao Bot sem Regressão:**
   - No `operational_adapter.ts` e `db_repository.ts`:
     * Perguntas sobre metas e acumulado consultam `metas_horarias` / `metas_diarias`.
     * Perguntas sobre faturamento de hoje consultam `getLatestDailyRevenue` (`faturamento_diario_horario`).
     * Perguntas sobre CMV, áreas e mídia consultam o snapshot mais recente de `faturamento_areas` e `cmv_lojas`.
   - Se o dado estiver `isStale = true`, injetar aviso amigável: *"Dado referente às HH:mm de DD/MM (atualização em processamento)"*.
3. **Build Gate & Suíte de Regressão Completa:**
   - Rodar todos os 389 testes existentes + novos testes das 3 frentes:
     `npx tsx src/hydra-sync/tests/test_*.ts`.
4. **Verificação no Banco Real SQLite da VPS:**
   - Confirmar presença de dados válidos para 10/10 lojas nas tabelas `cmv_lojas`, `faturamento_areas`, `metas_horarias` e `faturamento_diario_horario`.
5. **Hard Stop & Apresentação dos Resultados.**

---
# HARD STOP — Aguardando comando /sdd-apply ou /vibe-apply para iniciar a execução.
