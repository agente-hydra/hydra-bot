# Proposta de Mudança — Spec 049: Hydra Pátio — Reconciliação Cirúrgica, Expurgo Soberano de Fantasmas e Sincronização Matinal

## 1. Problema e Diagnóstico Forense

No batimento entre a planilha oficial [`Carros em Patio - 29-10-2026.xlsx`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/output/relatorios/Carros%20em%20Patio%20-%2029-10-2026.xlsx), os logs do extrator matinal ([`daily-crawl.log`](file:///home/operacional/hydra-data/logs/daily-crawl.log)), o banco SQLite ([`hydra_ops.db`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/data/hydra_ops.db)) e o ledger ([`patio_ledger_2026-10.json`](file:///C:/Users/User/Desktop/agy/projects/hydra-rede/data/patio_ledger_2026-10.json)), foram identificadas divergências críticas no saldo pendente e na quantidade de veículos no pátio:

- **Planilha de 29/10 (gerada às 00:05 AM):** 49 OSs ativas no pátio | Saldo Pendente: **R$ 72.325,37**
- **Banco SQLite / Pátio Real pós-crawl matinal (07:55 AM):** 43 OSs ativas no pátio | Saldo Pendente: **R$ 64.248,13**
- **Discrepância Real:** **+6 OSs a mais na planilha** e **+R$ 8.077,24 de saldo inflado**.

---

### Diagnóstico das 10 Lojas:

| Loja | Qtd Planilha | Saldo Planilha | Qtd Banco (07:55 AM) | Saldo Banco (07:55 AM) | Divergência | Status |
|---|---|---|---|---|---|---|
| **Planalto** | 5 | R$ 4.859,00 | 5 | R$ 4.859,00 | R$ 0,00 | ✅ 100% Conciliado |
| **Piraporinha** | 3 | R$ 10.848,90 | 3 | R$ 10.848,90 | R$ 0,00 | ✅ 100% Conciliado |
| **Mauá** | 4 | R$ 4.289,12 | 4 | R$ 4.289,12 | R$ 0,00 | ✅ 100% Conciliado |
| **Kennedy** | 3 | R$ 3.566,95 | 3 | R$ 3.566,95 | R$ 0,00 | ✅ 100% Conciliado |
| **Rudge Ramos** | 7 | R$ 8.897,70 | 7 | R$ 8.897,70 | R$ 0,00 | ✅ 100% Conciliado |
| **Santo André** | 6 | R$ 10.878,50 | 5 | R$ 10.441,26 | **+R$ 437,24** (1 OS fantasma #2489) | ❌ **Divergência** |
| **Rei do Módulo** | 13 | R$ 16.873,20 | 9 | R$ 10.083,20 | **+R$ 6.790,00** (4 OSs fantasmas #1937, #1936, #1929, #1925) | ❌ **Divergência** |
| **Jorge Beretta** | 1 | R$ 0,00 | 1 | R$ 0,00 | R$ 0,00 | ✅ 100% Conciliado |
| **Dom Pedro I** | 2 | R$ 2.968,00 | 2 | R$ 2.968,00 | R$ 0,00 | ✅ 100% Conciliado |
| **Jabaquara** | 5 | R$ 9.144,00 | 5 | R$ 9.144,00 | R$ 0,00 | ✅ 100% Conciliado |

---

### As 4 Causas-Raiz & Riscos de Contaminação Circular:

1. **Contaminação Circular do `wasOpenYesterday` em `patio_ledger_engine.js` (Linha 342):**
   - O filtro determinístico de expurgo exigia `&& !wasOpenYesterday`. Se uma execução anterior do ledger foi contaminada e registrou a OS fechada como aberta, `wasOpenYesterday` tornava-se `true`.
   - Como resultado, o `continue` não disparava. Em seguida, ao tentar corrigir a OS, o motor a jogava no bloco `else if (!isAbertaNow)`, marcando-a erroneamente como `foiFechadaOntem = true` (`YARD_EXIT` / "Saída de Pátio"), poluindo a planilha com saídas falsas de carros quitados semanas atrás.

2. **Ressurreição via `historicoAtualizadoEm` na Transição do Dia D (Linhas 374–392):**
   - As OSs **#1937**, **#1936**, **#1929**, **#1925** e **#2489** fecharam entre 13/10 e 21/10 (`is_aberta = 0`, `valor_restante = 0`).
   - Porém, a rotina matinal do crawler lê o grid do ERP e atualiza `historico_atualizado_em` para a data de hoje (`29/10/2026`).
   - A condição `(historicoBR && isDateAfter(historicoBR, lastRefDateBR) ...)` em `isClosedOnDayD` avaliava `29/10 > 28/10` como verdadeira, forçando `isAbertaD1 = true` e restaurando o `saldoPendenteD1` para o valor total da OS!

3. **Colapso de Horário Isolado (`HH:mm`) em `parseBRToDateObj` e Adapter:**
   - No ERP Oficina Inteligente, o campo `data_inicio` em várias OSs ativas vem preenchido apenas com a hora (`"11:13"`, `"15:58"`), constando a data completa apenas em `historico_criado_em`.
   - `parseBRToDateObj('11:13')` retornava `new Date()` (hoje).
   - O teste `isDateAfter(dataAbertura, '28/10/2026')` avaliava `29/10 > 28/10` como verdadeiro, descartando incorretamente OSs abertas legítimas do pátio ao reprocessar.

4. **Dessincronização Temporal do Cron da VPS:**
   - O cron da VPS gerava a planilha na virada da meia-noite (00:05 AM).
   - O Deep Crawler rodava entre 07:00 e 07:55 AM atualizando o banco e os arquivos `os_store_*.json`.
   - No entanto, a planilha `Carros em Patio - DD-MM-AAAA.xlsx` **nunca era reconstruída após o término do crawler matinal**.

---

## 2. As 4 Correções Cirúrgicas Obrigatórias

1. **Expurgo Soberano Independente de `wasOpenYesterday` (`src/patio_ledger_engine.js`):**
   - Na linha 342, remover `&& !wasOpenYesterday` da condição de expurgo:
     ```javascript
     const firstRefDateBR = refDatesList[0];
     if (!isAbertaNow && dataFechamentoBR && isDateBefore(dataFechamentoBR, firstRefDateBR)) {
       continue;
     }
     ```
   - Além disso, expurgo estrito de OSs quitadas sem movimentação em D-1:
     ```javascript
     const saldoRestanteReal = typeof rec.restanteERP === 'number' ? rec.restanteERP : (Number(rec.valor_restante) || Number(rec.saldoRestante) || 0);
     if (!isAbertaNow && saldoRestanteReal === 0 && !tevePagamentoOntem && (!dataFechamentoBR || !refDatesList.includes(dataFechamentoBR))) {
       continue;
     }
     ```

2. **Remoção Total de `historicoAtualizadoEm` e Bloqueio de Fechamento Passado em `isClosedOnDayD`:**
   - Se `dataFechamentoBR` existir e for anterior ou igual a `lastRefDateBR` (`!isDateAfter(dataFechamentoBR, lastRefDateBR)`), `isClosedOnDayD` DEVE ser `false`.
   - Remover sumariamente a cláusula `(historicoBR && isDateAfter(historicoBR, lastRefDateBR) ...)` de `isClosedOnDayD`, pois o toque de leitura matinal não representa fechamento físico no Dia D.

3. **Correção de Horário Isolado (`HH:mm`) no Adapter e no Engine:**
   - Em `patio_hydra_bot_adapter.js`, se `doc.data_inicio` contiver apenas hora (`/^\d{1,2}:\d{2}(:\d{2})?$/`), buscar a data real em `doc.primeira_data_aberta || doc.historico_criado_em`.
   - Em `patio_ledger_engine.js`:
     - `normalizeToBRDate` deve retornar `''` se a string contiver apenas hora isolada (`HH:mm`).
     - `parseBRToDateObj` deve retornar `null` (nunca `new Date()`) quando a string não tiver 3 partes `DD/MM/YYYY`.
     - `isDateAfter`, `isDateBefore`, `compareDatesBR` e `diffDays` devem checar `!o1 || !o2` com segurança nula.

4. **Limpeza do Ledger, Reconstrução e Auditoria de Prova Real (29/10/2026):**
   - Limpeza cirúrgica das OSs fantasmas em `patio_ledger_2026-10.json`.
   - Sincronização via SCP com a VPS (`100.126.50.101`).
   - Reconstrução da planilha `Carros em Patio - 29-10-2026.xlsx` (`node src/run_patio_daily.js --build-only --date=2026-10-29`).
   - Auditoria via `node scripts/audit_patio_discrepancies.js` comprovando **10/10 lojas 100% conciliadas (Diferença = R$ 0,00 em todas as 10 lojas)**.
   - Cópia da nova planilha corrigida para a Área de Trabalho do usuário (`C:\Users\User\Desktop\Carros em Patio - 29-10-2026.xlsx`).

---

## 3. Critérios de Aceite Definitivos

- [ ] Expurgo total das 5 OSs fantasmas (#1937, #1936, #1929, #1925 e #2489) sem gerar saídas falsas (`YARD_EXIT`).
- [ ] Santo André fecha exatamente em **R$ 10.441,26** (5 OSs ativas, Diferença = R$ 0,00).
- [ ] Rei do Módulo fecha exatamente em **R$ 10.083,20** (9 OSs ativas, Diferença = R$ 0,00).
- [ ] Total da Rede fecha exatamente em **R$ 64.248,13** (43 OSs ativas).
- [ ] Tabela comparativa do `audit_patio_discrepancies.js` com **todas as 10 lojas com Diferença = R$ 0,00**.
- [ ] Suíte de testes unitários dedicada (`projects/hydra-rede/tests/test_patio_reconciliation_audit.js`) rodando com 100% de aprovação.
- [ ] Nova planilha oficial `Carros em Patio - 29-10-2026.xlsx` copiada para o Desktop.
