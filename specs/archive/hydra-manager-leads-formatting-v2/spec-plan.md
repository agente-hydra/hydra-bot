# Plano de Implementação: hydra-manager-leads-formatting-v2

- [x] [FORMAT] Implementar funções utilitárias `formatBrazilianPhone` e compositores nativos `composeHydraLeadCard` e `composeHydraCancelCard` em `src/hydra-sync/mcp_lead_tools.ts`.
- [x] [SAFETY] Garantir preservação estrita do banner de teste e do envio forçado para `5511996242812` via `getEffectiveRecipientPhone`.
- [x] [TEST] Atualizar e rodar suíte de testes de templates e compositores em `src/hydra-sync/tests/test_mcp_leads_notifications.ts` (100% PASS).
- [x] [BUILD] Executar build gate `npx tsc --project tsconfig.hydra.json` e transpilar com esbuild.
- [x] [DEPLOY] Sincronizar arquivos para `/home/operacional/hydra-deploy/current/`, `/home/operacional/hydra/` e `/opt/bots/`. Reiniciar `hydra-bot` no PM2 com `--update-env`.
- [x] [VERIFY] Disparar nova notificação de teste para o número `11996242812` via MCP e certificar visual clean no WhatsApp real.
