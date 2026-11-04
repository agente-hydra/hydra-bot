# Spec 060 — Plano de Implementação por Fases

**ID da Spec:** `060-hydra-rede-captcha-bypass-live-auth`  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA — 10/10 TESTES APROVADOS — HARD STOP ATIVO (AGUARDANDO `/vibe-archive 060-hydra-rede-captcha-bypass-live-auth`)

---

## Estratégia de Execução

As tarefas estão divididas em unidades atômicas seguindo a sequência:
1. Instalação e verificação de pacotes na VPS (Xvfb, x11vnc, noVNC).
2. Construção do Daemon de Sessão Permanente (Keep-Alive).
3. Construção do Hub de Streaming Fluido noVNC + CDP.
4. Construção do Adaptador de Solver Automatizado (CapSolver).
5. Integração com Notificações WhatsApp (`hydra`) e auto-deploy.
6. Testes ponta a ponta e Hard Stop.

---

## Fase 0 — Baseline e Preparação do Ambiente na VPS

- [x] [LEAD] Inspecionar dependências do sistema na VPS (`sudo apt list --installed xvfb x11vnc websockify`) e validar disponibilidade do Google Chrome / Chromium.
- [x] [LEAD] Parar e remover serviços legados que falham no PM2 (`rede-auth-invisible`, `rede-auth-bridge`).
- [x] [LEAD] Testar execução isolada de `Xvfb :99` e bind de portas locais (`127.0.0.1:5900`, `127.0.0.1:9222`).

---

## Fase 1 — Daemon de Sessão Permanente (`rede_session_keeper.js`)

Arquivos: `projects/hydra-rede/src/rede_session_keeper.js`.

- [x] [PARALLEL: session_keeper] Implementar `RedeSessionKeeper` em Node.js com timer intervalado de 18 minutos (jitter ± 3 min).
- [x] [PARALLEL: session_keeper] Implementar leitura e validação da expiração de cookies em `data/storageState_rede.json`.
- [x] [PARALLEL: session_keeper] Executar requisições de heartbeat (`GET /` com cabeçalhos reais) sem levantar instâncias pesadas de navegador.
- [x] [PARALLEL: session_keeper] Gravar atomicamente o novo estado em `storageState_rede.json` e telemetria em `data/session_keeper_status.json`.
- [x] [PARALLEL: session_keeper] Disparar alerta prioritário via WhatsApp (`hydra`) para o desenvolvedor se o heartbeat detectar desautenticação (HTTP 401/403).

---

## Fase 2 — Adaptador de Solver Automatizado de Token (`recaptcha_enterprise_solver.js`)

Arquivos: `projects/hydra-rede/src/recaptcha_enterprise_solver.js`.

- [x] [PARALLEL: solver_adapter] Implementar classe `RecaptchaEnterpriseSolver` com suporte à API do CapSolver e 2Captcha.
- [x] [PARALLEL: solver_adapter] Implementar extração dinâmica do `sitekey` e URL da página via Playwright.
- [x] [PARALLEL: solver_adapter] Implementar injeção do token resolvido no elemento `#g-recaptcha-response` e emissão dos eventos sintéticos `input` e `change`.
- [x] [PARALLEL: solver_adapter] Integrar fallback automático dentro de `src/crawler_rede_stealth.py` e `src/scraper.js`.

---

## Fase 3 — Hub Remoto de Alta Fluidez com noVNC + CDP (`rede_live_auth_hub.js`)

Arquivos: `projects/hydra-rede/src/reconnect_system/rede_live_auth_hub.js`, `projects/hydra-rede/scripts/start_live_vnc.sh`.

- [x] [LEAD] Criar script shell de orquestração do display virtual Xvfb + x11vnc + noVNC/websockify.
- [x] [LEAD] Implementar inicialização do Chrome em modo **headed** com `--remote-debugging-port=9222` restrito a `127.0.0.1`.
- [x] [LEAD] Implementar conexão do Playwright com browser headed no display virtual.
- [x] [LEAD] Implementar preenchimento automático das credenciais sem expor a senha ao usuário.
- [x] [LEAD] Implementar listener de rota (`#nav-config` ou `/home` detectado) que salva `storageState_rede.json` e encerra a ponte suavemente.
- [x] [LEAD] Configurar timeout de auto-cleanup (15 minutos de inatividade encerra Xvfb e Chrome para não consumir memória da VPS).

---

## Fase 4 — Integração de Roteamento Traefik e Token Temporário de Acesso

Arquivos: `projects/hydra-rede/src/reconnect_system/auth_link_guard.js`.

- [x] [LEAD] Configurar rota reversa no Traefik apontando `https://bot.tork.services/rede-auth` com suporte total a WebSockets (`Connection: Upgrade`).
- [x] [LEAD] Implementar geração de link com token assinado HMAC-SHA256 (`?token=<hash>&exp=<timestamp>`) com expiração de 15 minutos.
- [x] [LEAD] Implementar middleware de validação do token antes de permitir o handshake WebSocket do noVNC.

---

## Fase 5 — Integração com Alertas do WhatsApp e Despachador Noturno

Arquivos: `projects/hydra-rede/src/run_nightly_prep.js`, `projects/hydra-rede/src/scraper.js`.

- [x] [LEAD] Atualizar `run_nightly_prep.js` para priorizar a sessão mantida pelo `rede_session_keeper.js`.
- [x] [LEAD] Atualizar emissão de links de emergência no WhatsApp para apontar para a nova URL fluida com o token gerado.
- [x] [LEAD] Garantir que o remetente de alertas seja estritamente `hydra` (+55 11 91783-7618) e nunca números de gerentes.

---

## Fase 6 — Testes, Validação Contratual e Hard Stop

Arquivos: `projects/hydra-rede/tests/test_spec060_live_auth_and_keeper.js`.

- [x] [LEAD] Executar cenários contratuais de teste (R01 a R10) — 10/10 PASS.
- [x] [LEAD] Validar ausência de vazamento de memória e término limpo de processos no Linux — CLEAN_NO_ZOMBIES.
- [x] [LEAD] Executar Hard Stop e aguardar aprovação do usuário para consolidação (/vibe-archive).
