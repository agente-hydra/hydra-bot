---
specialistId: specialist-messaging-whatsapp
specId: 078-rede-matinal-cron-restoration-patio-sheets
complexity: medium
anchors: ["projects/hydra-rede/src/run_morning_watchdog_0600.js:1", "projects/hydra-rede/src/whatsapp_unified_dispatcher.js:1"]
---
# Scout: WhatsApp Messaging, Watchdog 06:00 & Alerta Google Sheets

## Diagnóstico Refinado
1. **Watchdog 06:00 & CMV KPI (`servico_prestado_antispam_gate.js`):** Além de `run_morning_watchdog_0600.js` ausente na VPS, `run_cmv_kpi_gerentes.js:97` requer `./servico_prestado_antispam_gate` (também ausente no disco da VPS).
2. **Webhook Google Sheets (`sync_sheets_os_worker.js`):** O POST com `updates: []` retorna JSON 200 OK, mas ao enviar a atualização real da Linha 15, o Apps Script executa `setValues()` na aba inteira e o Google Sheets rejeita com HTML: `"Os dados inseridos na célula D8 violam o respectivo conjunto de regras de validação de dados"` (pois a atendente digitou `"-"` na célula D8). O worker engole a falha e encerra com `exit 0`.

## Recomendações
1. Restaurar `run_morning_watchdog_0600.js` e `servico_prestado_antispam_gate.js` na VPS.
2. Extrair o texto real do erro HTML do Apps Script em `GoogleSheetsClient`, alertar o Dev via instância `hydra` com o diagnóstico exato da célula bloqueada (`D8`) e retornar código de saída `1` quando o webhook falhar.
3. Preservar a trava incondicional: envio exclusivo pelas instâncias `hydra` e `atendimento`.
