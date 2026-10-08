# Plano de Implementação: Watchdog Sliding Idle Debounce

## Tarefas
- [x] T01: Backup preventivo de `gateway.js` e `worker.js` na VPS.
- [x] T02: Implementação do Sliding Idle Debounce (20 min) e Ceiling (2h) em `gateway.js`.
- [x] T03: Atualização dos pontos de limpeza de ciclo em `worker.js` (`debounce_start:conv`).
- [x] T04: Criação e execução de suíte de testes de estresse comprovando prorrogação e debounce.
- [x] T05: Recarregamento gracioso dos serviços via PM2 (`watchdog-gateway`, `watchdog-worker`).
- [x] T06: Validação de logs ao vivo e telemetria de funcionamento em tempo real.
