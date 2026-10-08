# Plano de Implementação: hydra-mcp-lead-instance-routing

- [x] [SECURITY] Implementar no `WhatsAppClient` (`whatsapp_client.ts` e `whatsapp_client.js`) a trava programática absoluta `ALLOWED_SENDER_INSTANCES = new Set(['hydra', 'atendimento'])` com `assertAllowedSenderInstance`.
- [x] [CLARIFY] Alinhar com o usuário qual instância oficial deve enviar as mensagens aos gerentes (`hydra` vs `atendimento`).
- [x] [CODE] Refatorar `src/hydra-sync/mcp_lead_tools.ts` para usar `getLeadNotificationInstance()` alimentado por `EVOLUTION_LEAD_INSTANCE` (sem hardcoding).
- [x] [CLIENT] Ajustar `src/hydra-sync/whatsapp_client.ts` para garantir que `config?.instance` tenha precedência absoluta quando fornecido (validado pela whitelist).
- [x] [CONFIG] Atualizar `/home/operacional/hydra/.env` com a instância confirmada pelo usuário.
- [x] [TEST] Atualizar e rodar suíte de testes unitários em `src/hydra-sync/tests/test_mcp_leads_notifications.ts` (100% PASS), incluindo teste de bloqueio de instâncias de gerentes.
- [x] [BUILD] Executar build gate `npx tsc --project tsconfig.hydra.json --noEmit` e transpilar esbuild.
- [x] [DEPLOY] Sincronizar na VPS e reiniciar `hydra-bot` no PM2 com `--update-env`.



