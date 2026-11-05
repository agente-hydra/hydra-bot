---
specialistId: specialist-crawler-rede
specId: 072-conciliacao-patio-rede-discrepancias
complexity: MEDIA
anchors: ["projects/hydra-rede/src/patio_ledger_engine.js:239", "projects/hydra-rede/src/patio_ledger_engine.js:256", "projects/hydra-rede/src/reconciliation_patio_rede_engine.js:559", "projects/hydra-rede/src/excel_patio_builder.js:233"]
---
Diagnóstico de Discrepâncias de Pátio x Rede (05/11/2026):
1. Re-injeção Retroativa de Pagamentos em OS Aberta:
   - Em `patio_ledger_engine.js:239`, a Âncora 3 de `estimateTransactionDateBR` assume que qualquer vencimento a 28-34 dias pertence à data de referência corrente, convertendo pagamentos de dias anteriores em novos recebimentos de D-1.
   - Em `patio_ledger_engine.js:256`, o registro de multiconjunto `seenRegistry` lê `seenCount`, mas injeta `g.items` incondicionalmente em `matchedPayments`, sem descartar transações já contabilizadas em dias anteriores (caso das OSs Kennedy 4461/4460 e Jabaquara 489).
2. Omissão de Pagamento Real em OS de Pátio:
   - OS Piraporinha 40465 (R$ 2.842,00 Crédito) foi exibida como aberta e pendente com pagamento `—`, divergindo da planilha manual do financeiro onde constava quitada em D-1.
3. Falso-Positivo de Candidato Aberto na Conciliação:
   - Em `reconciliation_patio_rede_engine.js:559`, a trava `isOsAberta` marca `ehCandidatoAberto = true` para qualquer pagamento histórico da OS, tentando conciliar pagamentos velhos contra lançamentos novos da máquina Rede.
4. Higienização de Saída de Pátio e Venda de Juros:
   - Desacoplar saídas do pátio confirmadas em D-2 (Santo André OSs 2520 e 2522) para que não ressuscitem em D-1.
   - Tratar formalmente o repasse de juros da operadora Rede (ex: Mauá OS 22660 e Rudge 8881) para conciliar a OS pelo valor nominal sem gerar resíduo financeiro artificial.
