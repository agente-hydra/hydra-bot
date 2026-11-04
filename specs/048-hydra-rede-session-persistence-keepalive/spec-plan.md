# Plano de Implementação — Spec 048: Hydra Rede — Persistência Contínua de Sessão, Keep-Alive Inteligente e Prevenção de Logouts na VPS

- [ ] [LEAD] 1. Criar o Módulo Modular de Keep-Alive em `projects/hydra-rede/src/session_keepalive.js`
  - Implementar `calcularProximoIntervaloComJitter` (10 a 14 min).
  - Implementar `executarPingKeepAlive` disparando chamada autenticada e capturando status HTTP e latência.
  - Implementar `salvarSessaoAtomica` gravando `storageState_rede.json` e `session_rede_cookies.json`.
  - Implementar controle de estado e cooldown de alertas de sessão.

- [ ] [LEAD] 2. Integrar o Keep-Alive Daemon no `projects/hydra-rede/src/rede_session_bridge.js`
  - Substituir o loop passivo por `iniciarSessaoKeepAlive()`.
  - Adicionar telemetria do Keep-Alive no endpoint `/api/status` e no template HTML do painel.
  - Eliminar o auto-submit cego de credenciais em headless quando a sessão estiver desconectada.
  - Adicionar disparo de alerta preventivo via `enviarAlertaDev` no WhatsApp (instância `hydra`) ao detectar desautenticação.

- [ ] [LEAD] 3. Blindar `projects/hydra-rede/src/scraper.js` contra Loops de reCAPTCHA
  - Refatorar `verificarOuLogar` para checar primeiro a frescura dos cookies e o status do bridge local.
  - Remover tentativas de preenchimento e clique forçado de senha quando em modo headless, emitindo log estruturado e aborto seguro.

- [ ] [LEAD] 4. Criar Suíte de Testes Unitários em `projects/hydra-rede/tests/test_session_persistence.js`
  - Validar cálculo determinístico de jitter e intervalos.
  - Validar simulação de renovação de sessão com mock de HTTP 200.
  - Validar detecção de 401/403 e disparo de alerta com cooldown anti-flood.
  - Validar trava contra submissão cega.
  - Integrar a nova suíte no executor geral `projects/hydra-rede/tests/run_all_tests.js` (Suíte 8).

- [ ] [LEAD] 5. Sincronização, Deploy e Validação na VPS de Produção
  - Sincronizar os novos arquivos via SCP para `operacional@100.126.50.101:/home/operacional/hydra-rede/`.
  - Reiniciar o daemon PM2 na VPS: `pm2 restart rede-auth-bridge`.
  - Validar logs do bridge (`pm2 logs rede-auth-bridge --lines 30`) e o primeiro ping de keep-alive.
  - Executar a bateria de testes completa na VPS e atestar 100% PASS.