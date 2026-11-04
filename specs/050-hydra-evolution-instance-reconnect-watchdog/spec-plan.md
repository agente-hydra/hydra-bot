# Plano de Implementação: Watchdog Autônomo de Reconexão de Instâncias Evolution

**ID da Spec:** `050-hydra-evolution-instance-reconnect-watchdog`  
**Data:** 29/10/2026  
**Status:** PLANO DE TAREFAS  

---

## Estratégia de Execução

- **Fase 1 (Módulos Core):** Serviço de consulta de instâncias e obtenção de QR Code via Evolution API.
- **Fase 2 (Página Web Live):** Rota/servidor HTTP leve para renderizar o QR Code auto-atualizável para abertura no PC.
- **Fase 3 (Daemon & Anti-Spam Gate):** Loop com máquina de estados, persistência de incidentes e despachos via instância `hydra`.
- **Fase 4 (Deploy na VPS & Validação):** Sincronização via SCP na VPS (`100.126.50.101`), teste real com `REI DO MODULO` e subida no PM2.

---

## Tasks

- [ ] **[LEAD] Tarefa 1: Módulo de Integração com a Evolution API (`evolution_qr_service.js`)**
  - Implementar métodos `fetchInstanceStatus(name)`, `fetchQrCode(name)` e `isInstanceConnected(name)`.
  - Adicionar tratamento para extrair a string `base64` limpa e o `count` da sessão.
  - Testar conexão real com a instância `REI DO MODULO`.

- [ ] **[LEAD] Tarefa 2: Servidor HTTP / Rota da Página Web Live (`qr_web_page.js`)**
  - Criar handler HTTP que responde em `/qr/reidomodulo` e `/api/qr/reidomodulo`.
  - Integrar auto-refresh em JavaScript client-side (15s) e transição para estado `CONECTADO`.
  - Testar renderização local e via curl.

- [ ] **[LEAD] Tarefa 3: Daemon de Monitoramento e Máquina de Estados Anti-Spam (`instance_watchdog_daemon.js`)**
  - Implementar loop de 60s monitorando `REI DO MODULO`.
  - Trava de horário comercial (07:30 - 19:30).
  - Controle de cooldown (mínimo de 3 minutos entre envios) e teto de tentativas (máx 3).
  - Persistência de estado em `reconnect_state.json`.
  - Trava de remetente estrita: envio EXCLUSIVO via `hydra`.
  - Notificação de sucesso ao restabelecer a conexão.

- [ ] **[LEAD] Tarefa 4: Teste de Disparo e Validação em Staging**
  - Rodar em modo `--dry-run` e validar se a imagem do QR Code e os textos são gerados perfeitamente.
  - Executar teste de pre-flight com a instância `hydra`.

- [ ] **[LEAD] Tarefa 5: Deploy e Ativação na VPS Operacional (`100.126.50.101`)**
  - Sincronizar os novos arquivos para `/home/operacional/hydra-rede/src/reconnect_watchdog/`.
  - Configurar processo no PM2 (`pm2 start ... --name hydra-reconnect-watchdog`).
  - Validar logs em tempo real.
