# Proposta: Resiliência do Heartbeat da Rede, Auto-Start da Ponte Web e Correção de Alertas

**Spec ID:** `039-hydra-rede-heartbeat-auth-bridge-resilience`  
**Data:** 27/10/2026  
**Status:** Planejamento (SDD Proposal)  
**Autor:** Antigravity AI  

---

## 1. Diagnóstico do Problema Factual

Às 19:16:11 do dia 27/10/2026, o desenvolvedor recebeu o seguinte alerta no WhatsApp:
```text
🚨 [ALERTA DE CONTINGÊNCIA — HYDRA PÁTIO]
Data/Hora: 27/10/2026, 19:16:11
Status: FALHA NA EXECUÇÃO MATINAL

Diagnóstico do Erro:
🚨 HYDRA HEARTBEAT (19:15) • SESSÃO REDE EXPIRADA

A sessão do portal Meu Rede caiu ou foi bloqueada por captcha.
Erro: Login bloqueado na tela inicial da Rede (reCAPTCHA pendente). Autentique via https://bot.tork.services/rede-auth

Acesse https://bot.tork.services/rede-auth para reautenticar antes da rotina noturna das 23h!

Ação de Segurança: O envio para o número da diretoria (+55 11 94066-7032) foi bloqueado preventivamente.
```

### O que realmente aconteceu na VPS? (Causa Raiz Comprovada)

1. **Rotina Cron das 19:15:**  
   O crontab da VPS possui o agendamento preventivo:  
   `15 19 * * 1-5 /home/operacional/hydra-rede/scripts/run-evening-heartbeat.sh`  
   Essa rotina roda às 19:15 (de segunda a sexta) para verificar a saúde da sessão do portal Meu Rede com 3h45 de antecedência em relação à esteira noturna das 23:00.

2. **Expiração Natural de Sessão da Rede:**  
   O arquivo `storageState_rede.json` havia sido atualizado pela última vez às 09:13 da manhã. O portal Meu Rede expira tokens e cookies JWT após 8 a 10 horas. Ao tentar acessar `https://meu.userede.com.br/home`, o Playwright foi redirecionado para a tela de login.

3. **reCAPTCHA v2 Bloqueou o Login Headless:**  
   O método `verificarOuLogar` preencheu usuário e senha e clicou em "Acessar", mas o Google reCAPTCHA acionou o desafio de fotos/verificação estrita. Como o navegador headless não consegue resolver puzzles visuais de forma determinística sem interação, estourou o timeout de 45s.

4. **Mensagem de Alerta Descontextualizada (Falso Positivo de Pátio/Matinal):**  
   A função `enviarAlertaDev` em `src/whatsapp_patio_dispatcher.js:1326` continha um cabeçalho estático e hardcoded:
   - Título: `[ALERTA DE CONTINGÊNCIA — HYDRA PÁTIO]`
   - Status: `FALHA NA EXECUÇÃO MATINAL`
   - Ação: `O envio para o número da diretoria (+55 11 94066-7032) foi bloqueado preventivamente.`  
   Isso gerou alarme desnecessário: às 19:16 da noite, a mensagem dizia que a rotina *matinal* havia falhado e que a diretoria havia sido bloqueada, quando na verdade era apenas a sonda preventiva do Meu Rede.

5. **Ponte Web `rede-auth` Estava Offline:**  
   O alerta instruía a acessar `https://bot.tork.services/rede-auth`, porém o serviço `src/rede_session_bridge.js` (porta 3899) **não estava rodando em background**. Ao abrir o link, o Traefik retornava `502 Bad Gateway` (Connection Refused).

---

## 2. Solução Proposta

### 2.1 Daemon Permanente da Ponte Web (`rede_session_bridge`) via PM2
Colocar o `rede_session_bridge.js` rodando de forma persistente sob o PM2 na VPS:
- Nome do processo: `rede-auth-bridge`
- Porta: `3899` (mapeada no Traefik para `https://bot.tork.services/rede-auth`)
- Benefício: `https://bot.tork.services/rede-auth` estará **100% online 24/7**. Sempre que o usuário ou dev receber um aviso, poderá clicar no link pelo celular e resolver o captcha interativamente em segundos, sem necessidade de SSH.

### 2.2 Desacoplamento e Sanitização dos Alertas no WhatsApp
Refatorar `enviarAlertaDev` em `whatsapp_patio_dispatcher.js` para suportar contextos reais:
- **Se `origem === 'HEARTBEAT_REDE'`:**
  ```text
  *HYDRA | Heartbeat Preventivo Meu Rede (19:15)*

  *27/10/2026 · 19:16*

  > *Diagnóstico de Sessão*
  - *Status:* Sessão expirada no portal Meu Rede
  - *Causa:* Desafio reCAPTCHA pendente
  - *Impacto:* Nenhum relatório da diretoria afetado neste horário

  > *Ação Rápida Recomendada*
  Acesse a ponte interativa abaixo pelo celular para reautenticar antes da rotina das 23h:
  https://bot.tork.services/rede-auth
  ```
- **Se `origem === 'PATIO_MATINAL'`:**
  Mantém o alerta operacional de pátio com indicação de bloqueio preventivo da diretoria.

### 2.3 Auto-Start de Contingência no `run_evening_heartbeat.js`
Caso o `run_evening_heartbeat.js` detecte falha de login no Meu Rede:
1. Verificar via HTTP se a ponte na porta 3899 está respondendo.
2. Se estiver offline, executar auto-spawn via `pm2 restart rede-auth-bridge` antes de enviar o alerta no WhatsApp.
3. Aguardar até 60 segundos após o disparo do alerta: se o operador autenticar via bridge nesse intervalo, o próprio heartbeat conclui a pré-extração sem registrar falha.

---

## 3. Risco e Mitigações

- **Risco:** O operador não ver a mensagem antes das 23h.
- **Mitigação:** A esteira noturna possui retries autônomos na madrugada às **01h, 03h, 05h e 07h**. Além disso, o watchdog das 06:00 AM (`run_morning_watchdog_0600.js`) tem capacidade de autolicença e fallback com os dados da véspera, impedindo que a diretoria fique sem relatório às 08:00 AM.
