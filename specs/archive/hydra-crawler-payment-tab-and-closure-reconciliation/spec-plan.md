# Plano de Execução: Mapeamento Total 360° da OS (9 Abas) e Conciliação no Crawler Hydra

**Spec ID:** `hydra-crawler-payment-tab-and-closure-reconciliation`  
**Data:** 09/10/2026  
**Status:** Planejamento Atualizado (SDD Proposal)  

---

## Tarefas de Implementação

- [x] [INSPECTOR-TAB-CYCLING] **Ciclo Sequencial de Ativação das 9 Abas no Playwright**
  - Em `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts`:
  - Implementar rotina `ativarTodasAsAbas(detailPage: Page)`.
  - Disparar cliques nas 9 abas:
    1. Produtos e Serviços
    2. Buscar Produtos e Serviços
    3. Pagamentos
    4. Documentos
    5. Notas
    6. Agendamento(s)
    7. Check-List
    8. Garantia(s)
    9. Histórico
  - Aguardar transição AJAX de cada aba com timeout defensivo de 300ms a 400ms.

- [x] [INSPECTOR-PARSER-360] **Parser Completo 360° no DOM (Cabeçalho + 9 Abas)**
  - Em `src/workers/oficina-agent/playwright/actions/os_deep_inspector.ts`:
  - **Cabeçalho:** Empresa, código, data de faturamento, início, fim, veículo, placa, hodômetro, ano, cliente, CPF, telefones, SMS, responsável, observação, crédito, status da OS e detecção de `"O.S. fechada e bloqueada"`.
  - **Aba 1 (Produtos e Serviços):** Grid de itens com código, referência, descrição, quantidade, valor unitário, total, mecânico e totais discriminados.
  - **Aba 2 (Buscar Produtos e Serviços):** Catálogo de itens e preços disponíveis.
  - **Aba 3 (Pagamentos):** Grid de parcelas com forma (PIX/cartão/etc.), vencimento, valor, enviado ao financeiro, total pago e valor restante.
  - **Aba 4 (Documentos):** Anexos com data, origem, descrição e opções.
  - **Aba 5 (Notas):** Notas fiscais vinculadas, chave, valor e emissão.
  - **Aba 6 (Agendamento/Alertas):** Agendamentos e manutenções preventivas.
  - **Aba 7 (Check-List):** Vistorias, tipo, data, executor, status, hodômetro, progresso e término.
  - **Aba 8 (Garantias):** Processos de garantia, operação e peças.
  - **Aba 9 (Histórico):** Criado por/em, atualizado por/em.

- [x] [CRAWLER-NOMINAL] **Endurecer Decisão de Transição Nominal em `deep-crawler.ts`**
  - Em `src/hydra-sync/deep-crawler.ts`:
  - Se `is_bloqueada_fechada`, `data_fim` presente, `statusGeral` contiver FECHAD/FATUR ou valor restante zero com total quitado: formalizar como `ENCERRADA` (`VALIDACAO_NOMINAL_FECHADA`).
  - Proibir categoricamente a reversão cega para `ABERTA`: exigir evidência nominal explícita de OS ativa e sem bloqueio.
  - Se inconclusivo, reter em `TRANSICAO_PENDENTE`.

- [x] [REPO-TRANSICAO] **Persistência Completa 360° em `formalizarTransicaoNominalOS`**
  - Em `src/hydra-sync/db_repository.ts`:
  - Atualizar `formalizarTransicaoNominalOS` para salvar `total_os`, `valor_pago`, `valor_restante`, `data_fim`, `data_fim_iso` e o novo `raw_payload` completo com as 9 abas.

- [x] [DB-RECONCILE] **Reconciliação no SQLite Operacional (`hydra_ops.db`)**
  - Atualizar a OS #1856 (Rei do Módulo) para `is_aberta = 0`, `estado_operacional = 'ENCERRADA'`, `total_os = 4000.00`, `valor_pago = 4000.00`, `valor_restante = 0.00`, `data_fim = '30/09/2026 13:17'`.
  - Executar auditoria de coerência em outras OSs da rede.

- [x] [TEST-AND-GATE] **Build Gate e Validação**
  - Executar `npx tsc --noEmit`.
  - Validar que a consulta de pátio e sinal de 60% reflete com fidelidade a ausência da OS #1856.
  - Sincronizar código na VPS Linux.
  - Disparar ambos os balões de validação para o número do desenvolvedor `5511996242812`.
