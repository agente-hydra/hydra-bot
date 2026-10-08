# Plano de Implementação — Correção da Contagem de OS em Aberto

**Spec:** `hydra-confirmed-open-os`  
**Data:** 06/10/2026  
**Repositório:** `hydra-bot`  
**SHA Base:** `3caf05bf1af6da2a24c2229de976961141e38bbd`  
**Status:** PLANO PRONTO PARA APLICAÇÃO (Aguardando `/vibe-apply hydra-confirmed-open-os`)  

---

## 1. Atribuição de Tarefas

> **Aviso de Restrição Técnica:** Por solicitação expressa do usuário, **nenhum teste automatizado, typecheck, fixture sintética ou pipeline de CI** será criado ou executado durante a aplicação. A validação técnica será substituída integralmente pelo teste conversacional conduzido pelo usuário no WhatsApp após a aplicação do patch.

---

### Fase 1: Executor 1 — Crawler, Export & Fallback

- [x] **[CRAWLER-EXPORT]** Inspecionar `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts` (linha ~367), localizar a função `extrairDetalhe(page, osId, baseUrl)` e adicionar o modificador `export`. Proibido duplicar código ou substituir por `extrairDetalheDaPagina`.
- [x] **[CRAWLER-IMPORT]** Verificar o import estático em `src/hydra-sync/deep-crawler.ts`:
  ```ts
  import { handleOSDeepInspector, extrairDetalhe } from '../workers/oficina-agent/playwright/actions/os_deep_inspector.js';
  ```
  Garantir que a resolução do módulo ocorra com sucesso sem recorrer a imports dinâmicos.
- [x] **[CRAWLER-FALLBACK]** Preservar a rotina de fallback existente: caso ocorra falha de extração em uma loja, assegurar que o snapshot anterior daquela unidade permaneça íntegro e registrar `recordDataWorkerRun(..., status: 'ERROR')`.
- [x] **[CRAWLER-TRANSITION]** Garantir que falhas de detalhamento nominal retornadas em `detalhe.erro` não promovam a OS nem encerrem a quarentena, mantendo a ordem com `estado_operacional = 'TRANSICAO_PENDENTE'`.
- [x] **[CRAWLER-REPORT]** Entregar ao Agente Principal a lista exata de linhas modificadas em ambos os arquivos e confirmar ausência de alterações em outros módulos.

---

### Fase 2: Executor 2 — Camada de Dados, Auditoria & Equivalência TS/JS

- [x] **[DB-CONTRACT-TS]** Em `src/hydra-sync/db_repository.ts`, declarar a interface `OpenOSCounts`:
  ```ts
  export interface OpenOSCounts {
    confirmed_open: number;
    transition_pending: number;
    total_open_like: number;
  }
  ```
- [x] **[DB-QUERY-TS]** Em `src/hydra-sync/db_repository.ts`, implementar a função `getOpenOSCounts(db, lojaSlug?)` utilizando a normalização `UPPER(TRIM(COALESCE(estado_operacional, '')))` e parametrizando `lojaSlug` de forma segura.
- [x] **[DB-LOGS-TS]** Em `getOpenOSCounts`, emitir o log estruturado JSON exclusivamente em `console.error` (stderr), garantindo total isolamento de stdout:
  ```json
  {"event":"hydra_open_os_counts","loja":"MPJabaquara","confirmed_open":3,"transition_pending":387,"total_open_like":390}
  ```
- [x] **[DB-PATIO-TS]** Em `src/hydra-sync/db_repository.ts`, atualizar `getPatioOverview(db)` para atribuir a contagem confirmada a `total_abertas` e expor `confirmed_open`, `transition_pending` e `total_open_like`, mantendo intocadas as fórmulas de `total_valor` e `total_restante`.
- [x] **[DB-DRILLDOWN-TS]** Em `src/hydra-sync/db_repository.ts`, atualizar `StoreDrilldownResult` e a função `getStoreDrilldown(db, lojaSlug)` para que `total_veiculos_patio` receba `confirmed_open` e os três campos de auditoria sejam disponibilizados.
- [x] **[DB-CHECKLIST-TS]** Em `src/hydra-sync/db_repository.ts`, atualizar a query de `getChecklistAudit(db, lojaSlug)` adicionando `AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'`, mantendo a coerência da população auditada.
- [x] **[DB-HEALTH-TS]** Em `src/hydra-sync/db_repository.ts`, atualizar `computeHydraHealthMetrics(db)` para atribuir `indiceVetorial.totalOSsAbertas = openCounts.confirmed_open`.
- [x] **[DB-SYNC-JS]** Espelhar todas as alterações acima em `src/hydra-sync/db_repository.js`, incluindo a função `getOpenOSCounts`, os ajustes de SQL nas 4 funções e a adição de `getOpenOSCounts` no bloco final de exports.
- [x] **[DB-REPORT]** Entregar ao Agente Principal a confirmação de que os arquivos `.ts` e `.js` possuem implementação semântica idêntica.

---

### Fase 3: Agente Principal — Consolidação e Roteiro de Verificação

- [x] **[PRINCIPAL-AUDIT]** Consolidar as entregas dos Executores 1 e 2 sem tocar em prompts, rotas, deploys ou regras conversacionais.
- [x] **[PRINCIPAL-DIFF]** Gerar inventário preciso dos arquivos e funções modificados.
- [x] **[PRINCIPAL-DECLARATION]** Registrar a declaração formal de conformidade:
  > *"Testes automatizados e validação técnica não executados, por solicitação expressa do usuário; teste conversacional pendente."*
- [x] **[PRINCIPAL-DISPATCH]** Entregar ao usuário o roteiro operacional da Seção 2 para execução no WhatsApp.

---

## 2. Roteiro de Teste do Usuário pelo WhatsApp

> **Importante:** Este teste deve ser executado **somente após a aplicação da versão corrigida no ambiente de execução do bot**.  
> Enviar **uma mensagem por vez**, aguardando a resposta completa antes de enviar a seguinte.

| Ordem | Mensagem Exata | Comportamento Esperado / O Que Observar |
|:---:|---|---|
| **1** | `/reset` | O bot confirma a limpeza e reinício do contexto de conversa. |
| **2** | `/perfil` | O bot exibe o perfil ativo e o escopo de atuação do operador. |
| **3** | `como tá Jabaquara?` | O bot traz o panorama operacional da unidade; anotar a quantidade de OS apresentada (deve refletir as confirmadas abertas, não as pendentes). |
| **4** | `quantas OS estão em aberto no Jabaquara?` | O bot responde à métrica direta de quantidade de OS em aberto da unidade. |
| **5** | `liste as OS abertas do Jabaquara` | O bot lista as OS consideradas ativas; verificar limites de paginação e total informado. |
| **6** | `OS's em aberto no Jabaquara` | Avaliar se a variante informal de pontuação é processada ou se cai no fallback `other`. |

---

## 3. Formato do Retorno do Usuário

Após concluir o envio das 6 mensagens acima, o usuário fornecerá o log completo da conversa no seguinte formato estruturado:

```text
Data da rodada:
Fuso: horário de Brasília (America/Sao_Paulo)
Hora da primeira mensagem:
Hora da última resposta ou da última espera:
Loja consultada:
Perfil mostrado em /perfil:
Versão/commit aplicado:
Contador do ERP e horário da observação (se houver):
```

---

## 4. Diagnóstico de Correlação Posterior

Ao receber os dados da rodada, o agente correlacionará as respostas do usuário com os registros do banco SQLite no intervalo correspondente (convertendo entre UTC e `America/Sao_Paulo`), verificando:

1. **Ingresso do Webhook:** Recebimento e enfileiramento sem colisões de lote.
2. **Classificação Semântica:** Roteamento e identificação correta de loja/operação.
3. **Telemetria de Contagem:** Presença do log `hydra_open_os_counts` com os valores exatos de `confirmed_open`, `transition_pending` e `total_open_like`.
4. **Alinhamento do Snapshot:** Confirmação de que a consulta reflete o último crawl nominal sem regressão de snapshot.
