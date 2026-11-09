# Plano de Execução — Spec 080: Matriz de Repasse da Rede (10x Sem Juros)

## Tarefas de Implementação

- [x] [SPECIALIST:specialist-crawler-rede] **T1 — Atualização da Matriz de Repasse no Gerador de Relatórios Excel**
  - Atualizar `TABELA_REPASSE` em `projects/hydra-rede/src/excel_processor.js` definindo faixas de 1 a 10 com taxa zero (`taxa: 0.000, divisor: 1.000, label: '0,0%'`).
  - Manter as faixas 11x a 18x com as taxas homologadas (11x = 13,5% até 18x = 18,0%).
  - Sincronizar matriz idêntica em `projects/hydra-rede/src/generate_7col_demo.js` e `projects/hydra-rede/src/generate_juros_options_demo.js`.
  - **Aceite (E2E Obrigatório):** `node -e "const { TABELA_REPASSE, calcularVendaJuros } = require('./projects/hydra-rede/src/excel_processor'); const assert = require('assert'); for (let i = 1; i <= 10; i++) { assert.strictEqual(TABELA_REPASSE[i].taxa, 0); assert.strictEqual(TABELA_REPASSE[i].divisor, 1); } const j10 = calcularVendaJuros(1000, 10); assert.strictEqual(j10.vendaJuros, 0); assert.strictEqual(j10.valorOriginal, 1000); const j11 = calcularVendaJuros(1135, 11); assert.strictEqual(j11.vendaJuros, 135); assert.strictEqual(j11.valorOriginal, 1000);"`

- [x] [SPECIALIST:specialist-crawler-rede] **T2 — Atualização da Matriz e Rótulos no Motor de Conciliação Pátio x Rede**
  - Atualizar `TABELA_REPASSE` em `projects/hydra-rede/src/reconciliation_patio_rede_engine.js` (1x a 10x sem juros).
  - Atualizar o rótulo de contingência em `enrichMatchRecord`: `cand.parcelas <= 10 ? '0,00% (≤10x)' : '0,00%'`.
  - Garantir que transações de 5x a 10x não ativem o Nível 6 de dedução de juros (`vendaJuros <= 0`), operando via Nível 1 com o valor bruto integral.
  - **Aceite (E2E Obrigatório):** `node -e "const { TABELA_REPASSE, calcularVendaJuros } = require('./projects/hydra-rede/src/reconciliation_patio_rede_engine'); const assert = require('assert'); for (let i = 1; i <= 10; i++) assert.strictEqual(TABELA_REPASSE[i].taxa, 0); const j10 = calcularVendaJuros(2500, 10); assert.strictEqual(j10.vendaJuros, 0); assert.strictEqual(j10.valorOriginal, 2500); const j12 = calcularVendaJuros(1140, 12); assert.strictEqual(j12.vendaJuros, 140); assert.strictEqual(j12.valorOriginal, 1000);"`

- [x] [LEAD] **T3 — Suíte de Testes da Spec 080, Validação na VPS e Build Gate Global**
  - Criar `projects/hydra-rede/tests/test_tabela_repasse_10x.js` cobrindo:
    1. Todas as 18 faixas de parcelamento (1x a 10x isentas e 11x a 18x com cálculo reverso exato).
    2. Geração da planilha `Juros Rede` de teste validando que coluna de juros é R$ 0,00 para 10x e valor positivo para 11x/12x.
    3. Conciliação com OS de teste em 10x e 12x.
  - Sincronizar arquivos para a VPS (`operacional@100.126.50.101:/home/operacional/hydra-rede/`).
  - Executar a suíte na VPS e verificar passagem com exit code 0.
  - **Aceite (E2E Obrigatório):** `node projects/hydra-rede/tests/test_tabela_repasse_10x.js && node projects/hydra-rede/tests/test_rede_fast_repair_suite.js --phase=all && ssh operacional@100.126.50.101 "cd /home/operacional/hydra-rede && node tests/test_tabela_repasse_10x.js"`
