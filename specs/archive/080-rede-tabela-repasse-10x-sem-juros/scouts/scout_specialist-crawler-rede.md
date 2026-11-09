---
specialistId: specialist-crawler-rede
specId: 080-rede-tabela-repasse-10x-sem-juros
complexity: low
anchors: ["projects/hydra-rede/src/excel_processor.js:45", "projects/hydra-rede/src/reconciliation_patio_rede_engine.js:210", "projects/hydra-rede/src/excel_conciliacao_builder.js:446"]
---

# Scout: Atualização da Matriz de Repasse (10x Sem Juros)

## Diagnóstico
Atualmente a matriz `TABELA_REPASSE` em `excel_processor.js` e `reconciliation_patio_rede_engine.js` considera isenção de juros apenas de 1x a 4x (taxa 0,0%). Entre 5x e 10x, o sistema calcula venda de juros escalonada (10,5% a 13,0%), deduzindo valores originais na conciliação e populando a coluna 'Venda de juros' no Excel.

A nova diretriz comercial estabelece parcelamento em **até 10x sem juros** (1x a 10x isentos de juros repassados). A cobrança de juros repassados passa a incidir estritamente **a partir de 11x** (11x = 13,5% até 18x = 18,0%).

## Recomendações
1. Atualizar `TABELA_REPASSE` em `excel_processor.js` definindo faixas 1 a 10 com `taxa: 0.000, divisor: 1.000, label: '0,0%'`.
2. Espelhar a mesma matriz em `reconciliation_patio_rede_engine.js` e ajustar a rotulagem de contingência para `cand.parcelas <= 10 ? '0,00% (≤10x)' : '0,00%'`.
3. Manter as faixas 11x a 18x inalteradas (11x = 13,5% até 18x = 18,0%).
4. Atualizar os scripts auxiliares de demonstração (`generate_7col_demo.js` e `generate_juros_options_demo.js`) para paridade total.
5. Criar suíte de testes unitários dedicada aferindo cálculo reverso, venda de juros zero para <= 10x e preservação de juros para >= 11x.
