# Proposta de Engenharia — Spec 080: Atualização da Matriz de Repasse da Rede (10x Sem Juros)

## 1. Problema e Contexto Comercial

Na esteira de processamento e conciliação da adquirente Rede (`projects/hydra-rede`), a apuração de vendas de cartões de crédito e o cálculo reverso de juros operavam sob a diretriz de **parcelamento sem juros em até 4x**. 

Sob essa regra legada:
- Transações de **1x a 4x** eram isentas (`taxa: 0.000, divisor: 1.000, label: '0,0%'`, gerando `vendaJuros = 0,00`).
- Transações de **5x a 10x** sofriam dedução regressiva de juros repassados (5x = 10,5%, 6x = 11,0%, 7x = 11,5%, 8x = 12,0%, 9x = 12,5% e 10x = 13,0%), populando a coluna *Venda de juros* no Excel e abatendo o valor da OS no Nível 6 do motor de conciliação.

A operação comercial das lojas atualizou a política de vendas para **até 10x sem juros**.
Dessa forma, clientes que parcelam em até 10 vezes não possuem acréscimo de juros na maquininha, e o valor integral da transação corresponde ao valor líquido/original do serviço ou peças.

A cobrança e o repasse de juros passam a ocorrer **exclusivamente a partir de 11x** (faixas de 11x a 18x).

---

## 2. Solução Proposta

1. **Atualização da `TABELA_REPASSE` em `excel_processor.js`:**
   - Redefinir as faixas de 5x a 10x para alíquota zero:
     - 1x a 10x: `taxa: 0.000, divisor: 1.000, label: '0,0%'`.
   - Preservar integralmente as alíquotas já homologadas de 11x a 18x:
     - 11x: 13,5% | 12x: 14,0% | 13x: 14,5% | 14x: 15,0% | 15x: 15,5% | 16x: 16,0% | 17x: 17,5% | 18x: 18,0%.

2. **Espelhamento em `reconciliation_patio_rede_engine.js`:**
   - Sincronizar a mesma matriz imutável `TABELA_REPASSE`.
   - Ajustar o rótulo de contingência em `enrichMatchRecord`:
     - De: `cand.parcelas <= 4 ? '0,00% (≤4x)' : '0,00%'`
     - Para: `cand.parcelas <= 10 ? '0,00% (≤10x)' : '0,00%'`.
   - No Nível 6 de conciliação, transações de 5x a 10x não sofrerão falsa dedução de juros (`vendaJuros <= 0`), permitindo que façam match direto pelo valor bruto exato com a OS.

3. **Sincronização dos Utilitários de Demonstração:**
   - Atualizar `src/generate_7col_demo.js` e `src/generate_juros_options_demo.js` para manter paridade documental e evitar divergências de teste.

4. **Verificação & Testes Automatizados:**
   - Criar `tests/test_tabela_repasse_10x.js` com cenários determinísticos:
     - Parcelas 1 a 10 com `vendaJuros == 0` e `valorOriginal == valorBruto`.
     - Parcela 11 com taxa 13,5% e cálculo reverso exato.
     - Parcela 12 com taxa 14,0% e cálculo reverso exato.
     - Validação de layout da planilha `Juros Rede` sem quebra de fórmulas ou colunas.

---

## 3. Especialistas Envolvidos

- **Líder (Single-Agent Orchestrator):** Arquitetura, governança, integração global, build gate e documentação.
- **`specialist-crawler-rede`:** Especialista em processamento de dados da Rede, matriz matemática de repasse e geração de relatórios Excel.

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Regressão na conciliação Pátio x Rede de vendas de 5x a 10x | Falso positivo ou OS sobrando sem match | No modelo anterior, vendas de 5x a 10x exigiam split de juros (Nível 6). Com a nova política comercial, o valor na maquininha é idêntico ao da OS, promovendo o match para Nível 1 (exato) de forma mais estável. |
| Divergência entre `excel_processor.js` e o motor de conciliação | Relatório de Juros diverge da planilha de Conciliação | Ambas as matrizes serão atualizadas em conjunto com teste unitário validando igualdade matemática estrita. |
