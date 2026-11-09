---
specialistId: specialist-messaging-whatsapp
specId: 081-patio-horario-pagamentos-live-probe-fix
complexity: low
anchors: ["projects/hydra-rede/src/whatsapp_patio_dispatcher.js:128", "projects/hydra-rede/src/run_group_balloon_dispatch.js:147", "projects/hydra-rede/src/patio_ledger_engine.js:795"]
---

## Diagnóstico
1. **Circuit Breaker com Mesmo Bug UTC (`whatsapp_patio_dispatcher.js:128`):** `new Date(r.updated_at).getTime()` sofre a mesma inversão de fuso UTC->BRT (-3h) para timestamps do SQLite sem `'Z'`, impedindo o Circuit Breaker de omitir candidatos stale quando `valor_pago === 0`.
2. **Balão 1 Vespertino Lendo Ledger Estático da Madrugada (`run_group_balloon_dispatch.js:147`):** Na geração do Balão 1 (09h e 15h), `summaryData` vem apenas de `getConsolidatedExecutiveSummary(monthStr)` (`ledger_YYYY-MM.json` das 05:41 AM), sem sobrescrever `totalOSsAbertas`, `totalValorPatio` e `totalSaldoPendente` com o snapshot diurno vivo (`recalcularSnapshotDiurno()`), mantendo o saldo pendente congelado mesmo após baixas e pagamentos diurnos.

## Recomendação
1. Aplicar `parseSqliteUtcTimestamp` e `financeiro_updated_at` no Circuit Breaker de `carregarCarrosCriticosSinal` (`whatsapp_patio_dispatcher.js:128`).
2. Em `run_group_balloon_dispatch.js:147` (Balão 1), executar primeiro `carregarCarrosCriticosSinalAsync(2600, 0.50)` (que atualiza eventuais pagamentos de última hora no banco/JSON) e em seguida consolidar `recalcularSnapshotDiurno()` para injetar `totalVeiculos`, `totalValorPatio` e `totalSaldoPendente` frescos em `summaryData`.
3. Manter a proibição absoluta de envio por instâncias de gerentes (exclusivo `hydra` / dry-run nos testes).
