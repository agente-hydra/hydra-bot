# Spec 060 — Validação Contratual e Critérios de Liberação

**ID da Spec:** `060-hydra-rede-captcha-bypass-live-auth`  
**Data:** 03/11/2026  
**Status:** MATRIZ DE TESTES CONTRATUAIS

---

## 1. Estratégia de Validação

Os testes contratuais asseguram que:
1. O daemon Keep-Alive mantém a sessão perpétua sem consumir CPU e sem expirar cookies.
2. A nova interface web transmite vídeo liso (30-60 FPS) e permite interação tátil direta no reCAPTCHA.
3. As portas sensíveis permanecem 100% blindadas para a internet pública (`127.0.0.1`).
4. O auto-save de `storageState_rede.json` funciona perfeitamente assim que o login é efetuado.
5. A extração das 10 lojas na esteira noturna roda sem qualquer queda em reCAPTCHA.

---

## 2. Cenários Contratuais (R01–R10)

| ID | Cenário | Critério de Aceitação / Resultado Esperado |
|---|---|---|
| **R01** | Inicialização do Xvfb e Chrome com porta CDP | `Xvfb :99` e Chrome iniciados com sucesso. Porta `127.0.0.1:9222` responde com JSON do CDP (`/json/version`). |
| **R02** | Streaming Fluido no noVNC sem `busy` lock | Conexão WebSocket noVNC estabelecida com sucesso. Taxa de atualização contínua e sem congelamento de imagem. |
| **R03** | Despacho de Toque e Clique no reCAPTCHA | Clique na tela virtual via noVNC aciona os seletores nativos do X11 sem latência do Playwright. |
| **R04** | Detecção Automática de Login e Auto-Save | Ao detectar transição para `/home`, o Playwright extrai os cookies, salva `storageState_rede.json` atomicamente e encerra a ponte. |
| **R05** | Daemon Keep-Alive mantendo cookies ativos | Execução de 3 ciclos de heartbeat de 18 min sem perda de autenticação, registrando telemetria em `session_keeper_status.json`. |
| **R06** | Injeção de Token do reCAPTCHA Enterprise | Script `recaptcha_enterprise_solver.js` popula `#g-recaptcha-response` e dispara eventos `input` e `change` válidos. |
| **R07** | Validação de Acesso Seguro por Token | Tentativa de conexão ao noVNC sem token válido ou com token expirado retorna HTTP 401 Unauthorized. |
| **R08** | Blindagem de Portas Sensíveis | Varredura de rede confirma que portas 9222 e 5900 rejeitam conexões externas e aceitam apenas `127.0.0.1`. |
| **R09** | Execução da Esteira Noturna sem Captcha | Execução de `run_nightly_prep.js` com a sessão mantida extrai as 10 lojas sem ser redirecionado para a tela de login. |
| **R10** | Limpeza de Processos Zumbis | Ao término ou timeout da ponte remota, nenhum processo órfão de Chrome ou Xvfb permanece consumindo memória na VPS. |

---

## 3. Critérios de Liberação para Produção

- 10/10 cenários (R01–R10) aprovados em ambiente de testes ou homologação.
- Validação no celular do operador confirmando que a imagem abre em menos de 2 segundos e responde aos toques com fluidez total.
- Zero envio de mensagens por instâncias não autorizadas (remetente exclusivo `hydra`).
- Hard Stop respeitado: aplicação no PM2 da VPS somente após comando `/vibe-apply 060-hydra-rede-captcha-bypass-live-auth`.
