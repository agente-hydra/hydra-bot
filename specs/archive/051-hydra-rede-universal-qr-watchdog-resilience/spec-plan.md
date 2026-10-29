# Plano de Implementação: Sistema Universal de Reconexão e Watchdog de WhatsApp (10 Lojas)

**ID da Spec:** `051-hydra-rede-universal-qr-watchdog-resilience`  
**Data:** 29/10/2026  
**Status:** PLANO DE TAREFAS MULTI-AGENTE (ALETHE / WORKTREES PARALELAS)  

---

## Estratégia de Execução com Subagentes

Para garantir entrega cirúrgica, rápida e com zero conflito de arquivos, o trabalho é particionado em **3 Frentes Especializadas Concorrentes** e consolidado pelo Líder Integrador:

- **Frente A (Subagente Concorrência & Evolution API):** Cliente HTTP resiliente, Single-Flight Request Locking, Cache TTL 9s e Pacing sequencial.
- **Frente B (Subagente Web Hub & Telas Live):** Servidor HTTP porta 3344, Hub Central (`/qr`) com grid das 10 lojas e telas individuais com auto-refresh (12s).
- **Frente C (Subagente Notificações & Grupo TI):** Repositório SQLite, regras anti-spam privadas e alertas automáticos no Grupo Oficial TI (`120363425738307789@g.us`).
- **Líder Integrador:** Daemon orquestrador (`watchdog_daemon.js`), suíte de testes de estresse, deploy via SCP na VPS (`100.126.50.101`) e registro no PM2.

---

## Tasks

### Fase 1: Implementação Paralela com Subagentes

- [x] **[PARALLEL: evo_concurrency] Tarefa 1: Cliente Evolution API & Pacing Sequencial (`evolution_client.js`, `config.js`)**
  - Implementar catálogo oficial das 10 lojas com apelidos e telefones canônicos.
  - Implementar cliente HTTP com `AbortSignal.timeout(5000)` e pool `keepAlive` (`maxSockets: 10`).
  - Implementar Single-Flight Request Locking e cache in-memory de QR Codes (TTL 9s).
  - Implementar varredura sequencial com pacing de `2.500ms ± 500ms jitter` entre lojas.
  - Testar isoladamente com mocks e chamadas reais em `evo.tork.services`.

- [x] **[PARALLEL: web_hub_ui] Tarefa 2: Servidor Web Hub Central & Páginas das Lojas (`web_server.js`)**
  - Implementar endpoint `/qr` servindo o Hub Central com as 10 lojas e badges em tempo real (`Online`, `Conectando`, `Desconectado`).
  - Implementar endpoint `/qr/:slug` servindo a página individual com auto-refresh sem F5 a cada 12 segundos e banner comemorativo verde pós-leitura.
  - Implementar endpoints JSON `/qr/api/status` e `/qr/api/code/:slug`.
  - Garantir bundle ultra-leve (<15KB por tela, zero dependências externas).
  - Testar renderização de todas as 10 lojas no navegador e via curl.

- [x] **[PARALLEL: group_messaging] Tarefa 3: Repositório SQLite & Notificações Privadas e em Grupo (`whatsapp_notifier.js`, `incident_repository.js`)**
  - Criar tabelas `hydra_reconnect_incidents` e `hydra_group_incident_notifications` no SQLite `/home/operacional/hydra-data/hydra_ops.db`.
  - Implementar disparador privado com trava rígida de remetente `hydra` (`5511917837618`), cooldown de 15 min e teto de 3 alertas por incidente.
  - Implementar disparador para o Grupo Oficial TI (`120363425738307789@g.us`):
    - Alerta único de queda no grupo com link para o gerente e hub da rede.
    - Confirmação de reconexão no grupo registrando horário e tempo fora do ar.
  - Implementar rotina matinal das 07:30 AM consolidando o status das 10 lojas no grupo.

---

### Fase 2: Integração e Orquestrador (Líder Integrador)

- [x] **[LEAD] Tarefa 4: Daemon Orquestrador Sequencial (`watchdog_daemon.js`)**
  - Integrar os módulos de Evolution, SQLite, Web Hub e Notificações no ciclo principal de 60 segundos.
  - Implementar filtro de flap de 30 segundos contínuos antes de abrir incidente.
  - Implementar auto-healing transparente para erros transitórios (408/515) via `POST /instance/restart`.
  - Implementar detecção de transição para `open` com notificação de encerramento em tempo real.

- [x] **[LEAD] Tarefa 5: Suíte de Testes Automatizados e Pre-Flight (`test_reconnect_system.js`)**
  - Simular desconexão e verificar:
    1. Zero stampede no cliente HTTP.
    2. Geração correta do QR Code em cache de 9s.
    3. Renderização perfeita do Hub e das telas individuais.
    4. Envio correto do alerta no privado e no grupo (com mock zero-leak).
    5. Fechamento do incidente ao reconectar.

---

### Fase 3: Deploy na Produção e Ativação na VPS

- [x] **[LEAD] Tarefa 6: Deploy na VPS Operacional (`100.126.50.101`)**
  - Sincronizar diretório `projects/hydra-rede/src/reconnect_system/` via SCP para `/home/operacional/hydra-rede/src/reconnect_system/`.
  - Atualizar arquivo Traefik `/opt/tork-stack/traefik/dynamic_qr.yml` apontando rotas `/qr` para o serviço consolidado na porta 3344.
  - Configurar e iniciar processos no PM2:
    - `pm2 restart hydra-qr-live` (Servidor Web Hub)
    - `pm2 start ... --name hydra-reconnect-watchdog` (Daemon de Monitoramento)
    - `pm2 save`
  - Validar logs em tempo real na VPS e confirmar que o Hub `https://bot.tork.services/qr` exibe as 10 lojas com status 100% fidedigno.
