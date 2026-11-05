# Proposta de Engenharia — Spec 072: Resolução de Discrepâncias de Pátio x Rede

> **Data:** 05/11/2026  
> **Status:** PROPOSTA / PLANEJAMENTO  
> **Especialistas Ativados:** `specialist-crawler-rede`  
> **Contexto Operacional:** Ajuste algorítmico e contábil na correlação entre o status físico de veículos em pátio (Ordens de Serviço do ERP) e a liquidação das maquininhas Rede para conciliação diária D-1, eliminando divergências apontadas na conferência financeira de 05/11/2026.

---

## 1. Problema e Evidências Forenses

Ao confrontar o relatório automatizado gerado pelo sistema (`Conciliacao Patio x Rede - 05-11-2026.xlsx`) com o livro de conciliação manual auditado pelo setor financeiro (`CONCILIAÇÃO 0511.xlsx`), foram identificadas 6 discrepâncias sistemáticas de contabilização:

1. **Omissão de Pagamento Real em OS de Pátio (Piraporinha OS #40465):**
   - Na conciliação manual: a OS #40465 de Piraporinha está com valor residual zerado e quitação de `Crédito R$ 2.842,00` no dia 04/11.
   - No relatório automatizado: a OS #40465 surge com valor de `R$ 2.842,00` e coluna de pagamentos vazia (`—`), inflando incorretamente o saldo aberto de pátio da loja.
   - *Causa:* Descompasso no algoritmo de data estimada `estimateTransactionDateBR` ou janela temporal estrita que rejeitou a parcela.

2. **Pagamento Fantasma em OS Aberta (Planalto OS #18537):**
   - No relatório automatizado: a OS #18537 é exibida com saldo de `R$ 2.725,02` e um pagamento novo destacado em azul `🔵 Credito: R$ 3.030,00`.
   - Na conferência manual: a OS #18537 está aberta com valor de `R$ 2.725,02` e **nenhum** pagamento realizado em D-1 (`Pagto: ""` / `—`).
   - *Causa:* Em `patio_ledger_engine.js:239`, a Âncora 3 de tolerância (28 a 34 dias) estima que o primeiro vencimento futuro pertence a D-1, e a regra `isOsAberta` em `reconciliation_patio_rede_engine.js:559` força a inclusão de parcelas antigas de OSs em aberto.

3. **Re-injeção Retroativa de Pagamentos de D-2 (Kennedy OS #4461 e OS #4460):**
   - No relatório automatizado de 05/11: OS #4461 surge com `🔵 Credito: R$ 5.131,10` e OS #4460 com `🔵 Credito: R$ 2.159,70` como novos pagamentos.
   - Na conferência manual: ambos os pagamentos foram realizados no dia 03/11 (D-2) e já foram baixados e conciliados na planilha de 04/11. Não houve novo pagamento em D-1.
   - *Causa:* Falha estrutural no multiconjunto `seenRegistry` em `patio_ledger_engine.js:256-261`: `matchedPayments.push(...g.items)` é executado incondicionalmente, mesmo que a assinatura da transação já tenha sido vista e contabilizada em D-2.

4. **Re-injeção de Pagamento Histórico (Jabaquara OS #489):**
   - No relatório automatizado: OS #489 (aberta em 24/10) exibe saldo de `R$ 1.707,56` com `🔵 Credito: R$ 2.561,34`.
   - Na conferência manual: a OS permanece aberta pelo valor de `R$ 1.707,56` sem pagamentos em D-1.

5. **Ressurreição Indevida de Saídas de Pátio Passadas (Santo André OS #2520 e OS #2522):**
   - No relatório automatizado: ambas aparecem em destaque âmbar como saídas de pátio de ontem.
   - Na conferência manual: essas saídas foram consumadas e registradas no ciclo anterior (04/11). Não devem reaparecer em 05/11.

6. **Divergência de Venda com Juros da Rede (Mauá OS #22660 e Rudge Ramos OS #8881):**
   - Na Rede, o valor cobrado no cartão foi de R$ 4.886,22 (Mauá) e R$ 1.206,46 (Rudge), enquanto a OS original no ERP faturou R$ 4.401,50 e R$ 1.058,30.
   - O financeiro registra o diferencial (`R$ 484,72` e `R$ 148,16`) separadamente como "Venda de Juros" na aba SALDO. A conciliação do motor identifica a divergência mas necessita de classificação limpa para não apontar erro ou resíduo falso de pátio.

---

## 2. Solução Proposta

1. **Correção da Deduplicação no Multiconjunto (`patio_ledger_engine.js`):**
   - Corrigir a lógica de `extractPaymentsForReferenceDay`: antes de adicionar itens a `matchedPayments`, verificar se a transação `sig` já foi consumida no `seenRegistry` histórico (`seenCount >= countInOS`).
   - Se a transação já foi atribuída a uma referência anterior (D-2 ou anterior), ela não pode ser re-injetada como novo pagamento em D-1.

2. **Calibração da Estimativa de Data para Crédito (`estimateTransactionDateBR`):**
   - Restringir a Âncora 3 de tolerância (28-34 dias): nunca associar automaticamente à data corrente se a OS estiver em aberto há mais de 3 dias e já possuir lançamento no histórico.
   - Para OSs abertas sem fechamento (`!dataFechamentoBR`), a data do pagamento deve respeitar prioritariamente a data de inserção da transação ou exigir que a primeira parcela coincida rigorosamente com o ciclo de 30 dias contados a partir da data de abertura ou de transação no gateway.

3. **Filtro Estrito de Candidatos Abertos na Conciliação (`reconciliation_patio_rede_engine.js`):**
   - Eliminar a flag permissiva `ehCandidatoAberto = true` incondicional (linhas 559-562 e 585-588).
   - Uma OS aberta só oferece pagamentos para a conciliação de D-1 se o pagamento individual tiver comprovante/vencimento compatível com D-1 ou se foi registrado no dia de ontem pelo crawler.

4. **Expurgo de Saídas de Pátio Repetidas:**
   - Garantir que uma OS finalizada e exibida como saída no dia D-2 não seja re-exibida no relatório de D-1, a menos que tenha ocorrido alteração no ERP.

5. **Alinhamento da Venda com Juros:**
   - Registrar no conciliador o split de parcelamento com juros repassados ao cliente, associando o valor nominal da OS à venda da Rede e vinculando o valor residual à rubrica de juros, espelhando a planilha manual do financeiro.

---

## 3. Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :-- | :-- | :-- |
| Deduplicação agressiva descartar pagamentos legítimos em OSs com múltiplas passadas de cartão idênticas | Alto | Utilizar contador de ocorrências por assinatura (multiconjunto ponderado) em vez de boolean flags simples |
| Restrição de OS aberta ocultar pagamentos parciais legítimos feitos no meio do conserto | Médio | Validar se o crawler detectou alteração no saldo devedor (`restanteERP`) entre a coleta de D-2 e D-1 |
| Variação no cálculo de juros entre bandeiras gerar pequenas diferenças de centavos | Baixo | Tolerância de centavos e verificação de modalidade Crédito Parcelado Emissor/Loja |

---

## 4. Critérios de Aceite Globais

- [ ] **AC-1:** OS Piraporinha #40465 exibe a quitação de `Crédito: R$ 2.842,00` e saldo zerado no relatório de Pátio D-1.
- [ ] **AC-2:** OSs Planalto #18537, Kennedy #4461, Kennedy #4460 e Jabaquara #489 não exibem falso pagamento novo (`🔵`) em 05/11/2026.
- [ ] **AC-3:** Saídas de pátio ocorridas em 04/11 (Santo André OS #2520 e OS #2522) não são duplicadas na planilha de 05/11.
- [ ] **AC-4:** O multiconjunto em `patio_ledger_engine.js` impede a contagem repetida de qualquer pagamento já liquidado em dias anteriores.
- [ ] **AC-5:** Transações com juros da Rede (Mauá OS #22660 e Rudge #8881) são conciliadas sem gerar divergência indevida.
- [ ] **AC-6:** A planilha gerada pelo motor para 05/11 bate em 100% dos saldos e pagamentos com a planilha manual `CONCILIAÇÃO 0511.xlsx`.
