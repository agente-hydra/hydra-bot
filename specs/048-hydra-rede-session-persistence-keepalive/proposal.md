# Proposta de Mudança — Spec 048: Hydra Rede — Persistência Contínua de Sessão, Keep-Alive Inteligente e Prevenção de Logouts na VPS

## 1. Problema e Diagnóstico Forense

Durante as execuções da esteira noturna e da madrugada do Hydra Rede (`projects/hydra-rede`), o scraper Playwright enfrenta interrupções críticas causadas pela **expiração silenciosa da sessão no portal Meu Rede (Itaú Unibanco)**:

```
[29/10/2026, 07:56:07] Carregando storageState existente de /home/operacional/hydra-rede/data/storageState_rede.json
[29/10/2026, 07:56:07] Verificando sessão no portal Rede...
[29/10/2026, 07:56:38] Sessão inativa ou redirecionada para tela de login.
[29/10/2026, 07:56:38] Iniciando login automático...
[29/10/2026, 07:56:38]   Preenchendo credenciais...
[29/10/2026, 07:56:39]   Submetendo formulário (1ª tentativa)...
[29/10/2026, 07:57:24] ❌ ERRO CRÍTICO NA EXECUÇÃO: Login bloqueado na tela inicial da Rede (reCAPTCHA pendente). Autentique via https://bot.tork.services/rede-auth
```

### Causas-Raiz Identificadas na Auditoria de Código e Logs da VPS:

1. **Janela Deslizante de Inatividade (Sliding Expiration de 15 a 30 minutos):**
   - Os tokens e cookies emitidos pelo portal Meu Rede possuem expiração por inatividade. Se nenhum tráfego HTTP autenticado for realizado pelo navegador dentro dessa janela, o backend da Rede invalida a sessão no servidor.
   - O daemon `rede-auth-bridge` (PID 2485) na VPS mantém o Chromium aberto, mas seu loop de monitoramento apenas inspeciona propriedades estáticas locais da aba (`page.url()`) a cada 3 segundos, **sem realizar nenhuma chamada de rede autenticada**.
   - Consequentemente, entre as 07:00 e as 09:48 (quase 3 horas de silêncio absoluto de rede), a sessão no servidor do Itaú expirou naturalmente.

2. **Gatilho de reCAPTCHA por Submissão Headless Cega (Anti-Pattern):**
   - Quando o scraper tenta rodar (às 23:00 ou às 05:00) com um `storageState_rede.json` cuja sessão já expirou no servidor, o portal redireciona para a home deslogada (`https://meu.userede.com.br/`).
   - O código em `scraper.js` (linhas 240-280) detecta a tela de login e tenta automaticamente digitar usuário e senha e submeter o formulário em modo headless.
   - **Efeito Colateral:** O WAF / Akamai detecta submissão automatizada de credenciais e imediatamente invoca o Google reCAPTCHA v2 / Enterprise com desafio de imagens ("Selecione todos os hidrantes"). Em ambiente Linux headless sem interface gráfica, isso paralisa a esteira até que alguém entre manualmente na Web Bridge.

3. **Ausência de Alerta Antecipado de Desconexão:**
   - O desenvolvedor só descobre que a sessão caiu no momento exato em que a esteira roda (às 07:45 AM ou 23:00), tarde demais para intervenção preventiva.

---

## 2. Solução Proposta — Arquitetura de Alta Disponibilidade de Sessão (Spec 048)

A solução **NÃO** envolve ferramentas de evasão de bots, patches não oficiais em C++ ou contorno forçado de CAPTCHAs (práticas frágeis, inseguras e incompatíveis com ambientes corporativos).

A abordagem soberana de engenharia de software consiste em **impedir que a sessão expire (Keep-Alive Contínuo)** e **proteger o robô contra submissões cegas**:

### 2.1 Daemon Ativo de Keep-Alive no `rede_session_bridge.js`
- Implementar um mecanismo autônomo de pulso (`SessaoKeepAliveDaemon`) dentro do serviço PM2 que roda 24/7 na VPS:
  - **Frequência:** A cada 12 minutos (com jitter aleatório de ±2 minutos, variando entre 10 e 14 minutos para comportamento orgânico).
  - **Ação:** Executa uma requisição leve e legítima a um endpoint autenticado da Rede (ex: `GET /api/fl2/prd/v1/downloads/queue` ou toque no perfil do usuário via `page.evaluate`).
  - **Efeito:** A resposta HTTP 200 renova a janela deslizante de expiração no backend do Itaú/Rede continuamente, mantendo a sessão viva por semanas ininterruptas sem exigir novos logins.
  - **Persistência Imediata:** A cada pulso bem-sucedido, o `context.storageState()` atualizado é gravado atomicamente em `data/storageState_rede.json` e `data/session_rede_cookies.json`.

### 2.2 Gate de Alerta Pró-Ativo & Bloqueio de Submissão Cega (Anti-Blind-Submit)
- Se o pulso de Keep-Alive detectar HTTP 401/403 ou redirecionamento para login:
  - **Trava de Segurança:** O bot é **terminantemente proibido** de tentar submeter credenciais automaticamente em headless (evitando atrair reCAPTCHAs de imagem).
  - **Alerta Pró-Ativo no WhatsApp:** Dispara imediatamente um alerta ao Dev (`5511996242812`) via instância `hydra` com o link `https://bot.tork.services/rede-auth`. Como o monitor roda 24/7, se a sessão cair às 15:00 ou 18:00, o Dev é avisado com muitas horas de antecedência em relação à janela crítica das 05:00 AM.

### 2.3 Blindagem do Scraper de Produção (`scraper.js`)
- Antes de iniciar a rodada das 10 lojas:
  - Valida se o `storageState_rede.json` está fresco.
  - Se estiver expirado, consulta o endpoint local `http://127.0.0.1:3899/rede-auth/api/status` do bridge para obter a sessão viva antes de iniciar o browser.
  - Se a sessão estiver de fato inativa, emite erro limpo e aborta sem disparar reCAPTCHA loops no portal.

---

## 3. Critérios de Aceite

- [ ] `rede_session_bridge.js` possui daemon de Keep-Alive com intervalo orgânico de 10 a 14 minutos.
- [ ] O Keep-Alive dispara requisição autenticada real e valida HTTP 200, renovando a janela de inatividade no servidor.
- [ ] A cada Keep-Alive confirmado, `storageState_rede.json` e `session_rede_cookies.json` são atualizados no disco.
- [ ] Em caso de expiração detectada, o robô NÃO tenta login cego headless e envia alerta preventivo no WhatsApp do Dev via instância `hydra`.
- [ ] `scraper.js` é protegido contra loops de submissão automática na tela de login.
- [ ] Suíte de testes unitários dedicada (`tests/test_session_persistence.js`) validando 100% dos cenários (keep-alive, persistência atômica, jitter e early-warning gate).
- [ ] Scripts atualizados e validados localmente e no PM2 da VPS (`pm2 restart rede-auth-bridge`).
- [ ] Build gate e suíte completa de testes (`projects/hydra-rede/tests/run_all_tests.js`) aprovados com 100% de sucesso.