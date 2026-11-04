# Plano de Implementação — Spec 049: Hydra Pátio — Reconciliação Cirúrgica, Expurgo Soberano de Fantasmas e Sincronização Matinal

- [x] [LEAD] 1. Corrigir Parser de Horário Isolado (`HH:mm`) e Fallback de Datas em `projects/hydra-rede/src/patio_hydra_bot_adapter.js`
  - Se `doc.data_inicio` contiver apenas hora (`HH:mm`), utilizar fallback para `doc.primeira_data_aberta` ou `doc.historico_criado_em`.
  - Estender `parseBotDateToBR(dateStr, fallbackStr)` para aceitar string de fallback quando o valor primário for apenas horário.

- [x] [LEAD] 2. Implementar as 3 Travas no Engine em `projects/hydra-rede/src/patio_ledger_engine.js`
  - **Correção 1 (Expurgo Soberano):** Remover `&& !wasOpenYesterday` da linha 342. Se `!isAbertaNow && dataFechamentoBR && isDateBefore(dataFechamentoBR, firstRefDateBR)`, executar `continue` imediato.
  - **Correção 1.1 (Expurgo de OS Quitada):** Se `!isAbertaNow && saldoRestante === 0 && !tevePagamentoOntem && (!dataFechamentoBR || !refDatesList.includes(dataFechamentoBR))`, executar `continue` imediato.
  - **Correção 2 (Bloqueio Dia D):** Se `dataFechamentoBR && !isDateAfter(dataFechamentoBR, lastRefDateBR)`, forçar `isClosedOnDayD = false`. Remover sumariamente a cláusula de `historicoBR`.
  - **Correção 3 (Null Safety):** Atualizar `normalizeToBRDate` para retornar `''` em `HH:mm`, `parseBRToDateObj` para retornar `null` em datas inválidas, e `isDateAfter` / `isDateBefore` / `compareDatesBR` / `diffDays` para tratar `null`.

- [x] [LEAD] 3. Desenvolver Suíte de Testes de Conciliação em `projects/hydra-rede/tests/test_patio_reconciliation_audit.js`
  - Validar bloqueio definitivo das 5 OSs zumbis (#1937, #1936, #1929, #1925, #2489) sem virar `YARD_EXIT`.
  - Validar resolução correta de hora isolada `11:13` para data real sem descarte incorreto.
  - Validar totalização das 10 lojas: Planalto (5), Piraporinha (3), Mauá (4), Kennedy (3), Rudge (7), Santo André (5), Rei do Módulo (9), Beretta (1), Dom Pedro (2), Jabaquara (5) -> Total: 43 OSs | R$ 64.248,13.
  - Integrar e rodar com sucesso via Node.

- [x] [LEAD] 4. Limpeza do Ledger, Sincronização com VPS e Regeneração da Planilha Oficial
  - Limpar registros corrompidos das OSs fantasmas em `patio_ledger_2026-10.json`.
  - Fazer upload via SCP dos arquivos corrigidos para `operacional@100.126.50.101:/home/operacional/hydra-rede/`.
  - Executar na VPS: `node src/run_patio_daily.js --build-only --date=2026-10-29`.
  - Sincronizar planilha gerada e rodar `node scripts/audit_patio_discrepancies.js`.
  - Validar que as 10/10 lojas apresentem **Diferença = R$ 0,00**.

- [x] [LEAD] 5. Entregar Planilha Conciliada no Desktop do Usuário
  - Copiar `projects/hydra-rede/output/relatorios/Carros em Patio - 29-10-2026.xlsx` para `C:\Users\User\Desktop\Carros em Patio - 29-10-2026.xlsx`.
  - Validar que o arquivo no Desktop possui tamanho e data de modificação atualizados.
