# Proposta de Engenharia — Spec 081: Sincronização Horária de Pagamentos no Pátio Ativo e Correção da Sonda Live Pré-Despacho

## 1. Problema Detalhado (Evidência Real de Produção — 09/11/2026 às 15:00)

No despacho vespertino das **15:00 (`09/11/2026`)**, o **Balão 1 (`HYDRA | Operação`)** enviou no grupo dos sócios:

```text
*Carros críticos sem sinal de 50%*
- Saldo em risco (pendência ≥ R$ 2.600): *R$ 23.848,70* (2 ordens em 2 lojas)

1. *Jorge Beretta*
- RANGER (OS #1159): *R$ 12.548,70* pendente (0% pago)
```

Porém, a auditoria direta ao vivo no ERP Oficina Inteligente comprovou que a **OS #1159 (`MPJorgeBeretta`, RANGER, placa `HYC7A72`) já estava 100% paga (`R$ 12.548,70` pagos em 10x de `R$ 1.254,87` no Crédito, saldo restante `R$ 0,00`)**.

A investigação forense no banco SQLite (`hydra_ops.db`), nos arquivos `os_store_*.json` e nos logs da VPS identificou **quatro falhas encadeadas**:

1. **Crawler Horário Raso (`patio_ativo_crawler.ts` às `:45` de cada hora):**
   - O cron horário (`45 8-22 * * * run-hydra-hourly-finance.sh`) executa `coletarPatioAtivoLoja`, mas lê **apenas a grade resumida de busca** (`wfOrdemDeServicoBusca.aspx`), que contém 11 colunas cadastrais (`Código, Data, Início, Fim, Veículo, Placa, Cliente, Previsão, Responsável, Pesquisa, Status`) e **nenhuma coluna financeira**.
   - Sem abrir o popup das OSs abertas (~21 ordens somando as 10 lojas), o coletor reaproveita `valor_pago: existing.valor_pago || 0` da extração da madrugada (`05:41 AM`), deixando todos os pagamentos lançados ao longo do dia congelados em `0` no SQLite e nos JSONs horários.
2. **Poluição Semântica de `updated_at` (`patio_ativo_crawler.ts:206`):**
   - A cada hora (`14:46:36 BRT`), o `patio_ativo_crawler.ts` executa `UPDATE ordens_servico SET ... updated_at = CURRENT_TIMESTAMP` mesmo sem tocar em `total_os`, `valor_pago` ou `valor_restante`, mascarando dados financeiros de 9+ horas atrás como se fossem recém-auditados.
3. **Sonda Ao Vivo (`os_live_probe.js`) Neutralizada por Fuso Horário UTC sem `'Z'` (`os_live_probe.js:65` e `whatsapp_patio_dispatcher.js:129`):**
   - O SQLite grava `CURRENT_TIMESTAMP` em **UTC sem `'Z'`** (`"2026-11-09 17:46:36"`). No Node.js da VPS (`TZ=America/Sao_Paulo`, UTC-3), `new Date("2026-11-09 17:46:36")` interpreta o horário como **17:46:36 local (+2h46m no futuro em relação às 15:00 BRT)**.
   - O cálculo `age = Date.now() - dt.getTime()` produziu **`-9.993.000 ms` (negativo)**, fazendo `age > FIVE_MINUTES_MS` retornar `false` em **100% das execuções** — transformando a sonda em tempo real (`probeOSLive`) e o Circuit Breaker em código morto.
4. **Seletor de Status Corrompido em `os_live_probe.js:244`, Totais Estáticos no Balão 1 (`run_group_balloon_dispatch.js:147`) e Drift Git/VPS:**
   - Em `os_live_probe.js:244`, `[id*="Status"]` captura o `<select>` inteiro concatenando todas as `<option>` em `status_grid`.
   - Em `run_group_balloon_dispatch.js:147`, o cabeçalho de Pátio Ativo do Balão 1 lia apenas `getConsolidatedExecutiveSummary(monthStr)` (ledger estático das 05:41 AM) em vez de consolidar `recalcularSnapshotDiurno()`, mantendo `Valor total do pátio` e `Saldo total pendente` congelados às 15:00.
   - `patio_ativo_crawler.ts` existia apenas na VPS (`/home/operacional/hydra-deploy/current/src/hydra-sync/`) sem versionamento no repositório Git local (`src/hydra-sync/`).

## 2. Solução Proposta

1. **Extração Financeira Horária Real das OSs Abertas (`src/hydra-sync/patio_ativo_crawler.ts`):**
   - Versionar `patio_ativo_crawler.ts` e sincronizar `hourly_finance_worker.ts` no repositório Git.
   - Durante o loop horário das `:45`, para cada OS aberta na grade (~21 veículos na rede inteira, ~2,1 por loja), abrir o popup de detalhe na mesma sessão autenticada, ativar `tapPagamento` quando necessário, extrair `total_os`, `valor_pago`, `valor_restante`, `pagamentos` e `is_bloqueada_fechada`, e fazer **UPSERT completo** tanto em `os_store_<slug>.json` quanto em `ordens_servico` (incluindo OSs recém-abertas no dia), registrando timestamp explícito `financeiro_updated_at` em ISO-8601 UTC (`...Z`).
2. **Correção Definitiva de Fuso UTC, Aba Pagamentos e Persistência Dual na Sonda Live (`projects/hydra-rede/src/os_live_probe.js`):**
   - Criar helper determinístico `parseTimestampUtcMs(ts)` que converte formatos SQLite UTC sem fuso (`YYYY-MM-DD HH:MM:SS`) adicionando `'T'` + `'Z'`, eliminando idades negativas tanto em `os_live_probe.js` quanto no Circuit Breaker de `whatsapp_patio_dispatcher.js`.
   - Basear `necessitaRevalidacao` prioritariamente em `financeiro_updated_at` (fallback `updated_at`), garantindo que updates rasos nunca inibam a sonda.
   - Em `probeOSLive`: clicar explicitamente na aba `Pagamentos` (`[id*="tapPagamento"]`), somar parcelas de `ucOrdemDeServicoPagamento_grd` como fallback auditável (removendo a inferência cega `valorPago = totalOs` quando o campo não carregou), ler `select[id*="ddlStatus"] option:checked` sem poluir `status_grid`, e persistir os valores revalidados tanto no SQLite (`ordens_servico`) quanto em `os_store_<slug>.json`.
3. **Totais de Pátio Ativo Vivos no Balão 1 (`projects/hydra-rede/src/run_group_balloon_dispatch.js`):**
   - Executar `carregarCarrosCriticosSinalAsync(2600, 0.50)` **antes** da montagem do resumo e sobrepor `totalOSsAbertas`, `totalValorPatio` e `totalSaldoPendente` de `summaryData` com os valores frescos de `recalcularSnapshotDiurno()`, garantindo coerência matemática absoluta entre o cabeçalho do pátio e a lista de carros sem sinal às 09:00 e às 15:00.

## 3. Especialistas Envolvidos

- **`specialist-crawler-rede`**: Enriquecimento financeiro do `patio_ativo_crawler.ts` e correção de fuso/DOM/persistência em `os_live_probe.js`.
- **`specialist-messaging-whatsapp`**: Correção do Circuit Breaker UTC em `whatsapp_patio_dispatcher.js` e injeção do snapshot diurno vivo no Balão 1 em `run_group_balloon_dispatch.js`.
- **`specialist-ops-infra`**: Eliminação do drift Git <-> VPS (`hourly_finance_worker.ts` + `patio_ativo_crawler.ts`), validação de build/typecheck e execução do probe E2E real na VPS.

## 4. Riscos e Mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Aumento do tempo de execução do `hourly_finance_worker.ts` ao abrir popups das OSs abertas | Médio | A rede inteira possui ~20 a 30 OSs abertas (~2 a 3 por loja). Com timeout individual de 12s por popup e leitura direta, o acréscimo é de ~25-35s no ciclo total (hoje ~2 min contra limite de `timeout 20m` no `run-hydra-hourly-finance.sh`). |
| Popup bloqueado ou falha transitória em uma OS específica durante o crawl horário | Baixo | Isolamento `try/catch/finally` por OS fechando sempre `detailPage`, preservando `existing.valor_pago` caso o popup falhe e mantendo `financeiro_updated_at` antigo para forçar revalidação obrigatória pelo `os_live_probe.js` antes do despacho. |
| Disparo acidental de mensagem real durante validação E2E | Crítico | Uso estrito de `--dry-run --target=dev` nas simulações de balão e proibição programática absoluta de qualquer instância de gerente (Regra 11). |
