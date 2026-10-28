# Plano de Implementação: Resiliência do Heartbeat da Rede, Auto-Start da Ponte Web e Correção de Alertas

**Spec ID:** `039-hydra-rede-heartbeat-auth-bridge-resilience`  
**Data:** 27/10/2026  
**Status:** Planejamento (SDD Proposal)  

---

## Fases de Execução

### Fase 1: Desacoplamento e Refatoração dos Alertas WhatsApp
- [ ] **[WA-01]** Refatorar a função `enviarAlertaDev` em `src/whatsapp_patio_dispatcher.js` para aceitar parâmetro de origem estruturado (`HEARTBEAT_REDE`, `PATIO_MATINAL`, `ESTEIRA_NOTURNA`, etc.), eliminando textos fixos de "FALHA NA EXECUÇÃO MATINAL" quando o erro for vespertino ou da Rede.
- [ ] **[WA-02]** Aplicar formatação Hermes 2.0 no alerta de Heartbeat da Rede, incluindo link direto da ponte web (`https://bot.tork.services/rede-auth`) e aviso explícito de que a diretoria não foi afetada.

### Fase 2: Auto-Start e Resiliência no Heartbeat
- [ ] **[CRON-01]** Modificar `src/run_evening_heartbeat.js` para invocar `enviarAlertaDev` com a origem `HEARTBEAT_REDE`.
- [ ] **[CRON-02]** Implementar verificação de integridade da porta 3899 no `run_evening_heartbeat.js`: se o bridge estiver inativo, realizar auto-spawn ou comando PM2 para garantir que o link `rede-auth` esteja online no momento em que o alerta for entregue.

### Fase 3: Daemonização Permanente no PM2 na VPS
- [ ] **[PM2-01]** Criar o manifesto `ecosystem.config.js` em `/home/operacional/hydra-rede/` com o processo `rede-auth-bridge` configurado na porta 3899.
- [ ] **[PM2-02]** Iniciar e persistir `rede-auth-bridge` no PM2 da VPS (`pm2 start ecosystem.config.js && pm2 save`), garantindo disponibilidade 24/7 de `https://bot.tork.services/rede-auth`.

### Fase 4: Testes & Verificação
- [ ] **[TEST-01]** Executar teste unitário em sandbox para validar a nova formatação contextual de `enviarAlertaDev` com zero disparos reais.
- [ ] **[TEST-02]** Testar requisição HTTP para `https://bot.tork.services/rede-auth` garantindo resposta HTTP 200 através do Traefik.
