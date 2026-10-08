# Plano de Execução: Admin Joacir, Broadcast Blindado Grupo Mecânica TI & Liquidação D+1

**Spec ID:** `hydra-admin-group-and-settlement`  
**Status:** CONCLUÍDO (Pronto para `/vibe-archive hydra-admin-group-and-settlement`)  
**Nota:** Supressão total de arquivos .xlsx para grupos WhatsApp (@g.us) implementada e validada em `whatsapp_patio_dispatcher.js` e `index.js`.

---

## Tasks

### Fase 1: Cadastro de Segurança & Permissões no SQLite
- [x] [DB] Cadastrar Joacir Barros (`5511947645967`) na tabela `hydra_authorized_users` no banco `/home/operacional/hydra-data/hydra_ops.db` com role `'socio'`, `allowed_stores = '["*"]'`, `is_active = 1`, `can_simulate_persona = 1`.
- [x] [DB] Registrar identidade canônica em `hydra_phone_identities` vinculando `5511947645967@s.whatsapp.net` a `5511947645967`.
- [x] [DB] Validar via query que o registro está ativo e idempotente.

### Fase 2: Blindagem Estrita de Ingress para Grupos (Zero Conversação no Grupo)
- [x] [INGRESS] Atualizar `identity_access_guard.ts` em `src/hydra-sync/` e no deploy de produção para interceptar `rawRemoteJid.endsWith('@g.us')`.
- [x] [INGRESS] Retornar HTTP 200 `{"status": "ignored_group"}` imediatamente sem registrar reação 👀, sem acionar typing `composing` e sem chamar LLM/fila.
- [x] [INGRESS] Testar via suite de testes unitários que mensagens com JID de grupo (`120363425738307789@g.us`) são 100% descartadas.

### Fase 3: Roteamento de Alertas do Supervisor Watchdog
- [x] [WATCHDOG] Atualizar `/home/operacional/watchdog/worker.js` para despachar alertas de análise das conversas dos gerentes para o grupo `120363425738307789@g.us` via Evolution API (`/message/sendText/hydra`).
- [x] [WATCHDOG] Incluir Joacir Barros (`5511947645967`) nos destinatários diretos de alertas do Watchdog.
- [x] [WATCHDOG] Reiniciar daemons PM2 `watchdog-worker` e `watchdog-gateway` e validar logs.

### Fase 4: Cálculo e Exibição de Liquidação D+1 Matinal (Cair Hoje)
- [x] [PATIO] Atualizar `projects/hydra-rede/src/patio_ledger_engine.js` para calcular `liquidacaoPrevistaHoje`:
  - Somar pagamentos em Cartão de Débito recebidos em D-1 como "Caindo hoje pela manhã".
  - Somar Pix e Dinheiro como "Já disponível ontem".
  - Totalizar disponibilidade imediata matinal.
- [x] [PATIO] Atualizar `projects/hydra-rede/src/whatsapp_patio_dispatcher.js` para incluir o bloco visual `💵 PREVISÃO DE ENTRADA HOJE (MANHÃ)` no card executivo do WhatsApp.
- [x] [PATIO] Configurar disparo do relatório de Pátio & OS para o grupo `120363425738307789@g.us` e para o novo admin `5511947645967`.

### Fase 5: Integração do Relatório de Juros e Taxas Rede
- [x] [REDE] Atualizar `projects/hydra-rede/src/whatsapp_notifier.js` e `index.js` para incluir `5511947645967` e o grupo `120363425738307789@g.us` na lista de distribuição matinal oficial das 08:00 AM.
- [x] [REDE] Executar teste de envio com `--now --dest=120363425738307789@g.us` em modo dry-run para validar entrega no grupo.

### Fase 6: Validação Final & Build Gate
- [x] [GATE] Executar `npm run typecheck:hydra` no staging do Hydra Bot para garantir zero erros de compilação.
- [x] [GATE] Reiniciar `hydra-bot` no PM2 da VPS e confirmar status online.
