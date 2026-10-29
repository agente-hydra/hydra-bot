# Proposta: Unificação do SLA da Central (Padrão Rei do Módulo), Isolamento de Lojas e Links Chatwoot para Leads

**ID da Spec:** `053-central-sla-lead-recovery-routing`  
**Data:** 29/10/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply 053-central-sla-lead-recovery-routing`)  
**Target:** VPS Linux Operacional (`100.126.50.101`) / PM2 `watchdog-gateway`, `watchdog-worker`, `bot-reativacao` / Evolution API v2 / Chatwoot v3  

---

## 1. Problema Observado e Diagnóstico

1. **SLA da Central Desatualizado e Rude (Sem Triagem Semântica):**
   - O monitor atual em `central_sla.js` opera com timer fixo de 10 minutos (`CENTRAL_SLA_SECONDS = 600`) implementado puramente via código simples, sem nenhuma camada de triagem semântica.
   - Mensagens de encerramento ou cortesia enviadas por clientes (*"valeu"*, *"show"*, *"obrigado"*, *"combinado"*, emojis `👍`) continuam armando o timer de pendência no Redis (`central_sla:pending`). Ao completar 10 minutos sem resposta da atendente Kamila, o sistema emite alertas falsos no WhatsApp da Central.
   - O formato do alerta atual é rude, sem identidade visual, e omite o link do Chatwoot sempre que o telefone do cliente está presente (enviando apenas `wa.me`), forçando a atendente a alternar telas manualmente.

2. **Contaminação de Alertas de Outras Lojas na Central ("Avisos sem nexo"):**
   - No `gateway.js`, a rotina de detecção de respostas de leads de reativação (`handlePossibleLeadReply`) é disparada para mensagens recebidas em **todas as 16 inboxes da rede**, sem filtro de origem.
   - Quando um cliente cadastrado no CRM de reativação responde a uma conversa de balcão da Loja Mauá (Inbox 9), Kennedy (Inbox 3) ou Jabaquara (Inbox 6), o sistema dispara um alerta no número da Central de Atendimento (`5511996274141`) sem o contexto da loja correta.
   - A equipe da Central recebe notificações de clientes que estão em atendimento presencial em lojas físicas distantes, gerando confusão operacional e sensação de avisos "sem nexo".

3. **Ausência / Quebra do Link do Chatwoot nas Recuperações de Leads:**
   - Nos avisos de lead recuperado da campanha da instância `atendimento` (Inbox 1), o link de direcionamento para o Chatwoot frequentemente sai truncado ou como `.../conversations/undefined` devido a variações no payload de webhooks do Chatwoot (onde o ID da conversa pode vir como `conversation.id`, `conversation_id` ou dentro de `contact_inbox`).
   - Sem o link direto, a atendente precisa pesquisar o nome ou telefone do cliente manualmente na barra de busca do Chatwoot, atrasando a conversão do lead quente.

---

## 2. Solução Proposta em 3 Pilares

### Pilar 1: Unificação do Motor de SLA da Central (Padrão Rei do Módulo)
- **Modernização de `central_sla.js`:**
  - Redução do limiar de SLA de 10 para **5 minutos** (`SLA_THRESHOLD_SECONDS = 300`), alinhando o tempo de resposta da Central ao padrão do Rei do Módulo.
  - Adoção integral do **Motor de Triagem em Cascata** desenvolvido na Spec 052:
    - **Camada 1 (Regex Shield):** Descarte imediato (<1ms) de encerramentos, confirmações, agradecimentos e reações com emojis.
    - **Camada 2 (Local SLM Qwen 2.5 1.5B):** Avaliação de mensagens ambíguas via inferência nativa em CPU.
    - **Camada 3 (Cloud Fallback Gemini 2.5 Flash):** Resiliência incondicional caso o servidor local esteja ocupado.
  - Cancelamento instantâneo do timer quando a Kamila ou atendente envia mensagem (`message_type === 1` / `outgoing`).
  - **Layout do Alerta Idêntico ao Rei do Módulo:** Inclui nome, telefone formatado, horário do cliente, tempo decorrido, citação da mensagem, **link direto do WhatsApp (`wa.me`)** E **link direto do Chatwoot**.
  - Destinatário: Número oficial da Central de Atendimento (`5511996274141` / `5511917698769`). Remetente exclusivo: `hydra` (`5511917837618`).

### Pilar 2: Isolamento de Escopo e Roteamento Preciso de Leads por Loja
- **Filtro de Origem em `gateway.js` e `lead_reply_notifier.js`:**
  - **Se a mensagem pertencer à Central (Inbox 1 ou 16):**
    - Classificada com a tag `[RECUPERAÇÃO DE LEAD | ATENDIMENTO CENTRAL]`.
    - Despachada para o WhatsApp da Central com os dados do cliente e link do ticket.
  - **Se a mensagem pertencer a uma Loja Física (Inboxes 2 a 10):**
    - **NUNCA** despejar como atendimento da Central.
    - Roteamento inteligente: O alerta é enviado diretamente para o WhatsApp do Gerente da respectiva Loja (ex: Erik em Jorge Beretta, Lucas em Rudge Ramos, Paulo em Kennedy), identificado como `[RECUPERAÇÃO DE LEAD | LOJA {{NOME}}]`.
    - Se a Central for configurada como supervisão, a mensagem explicita com destaque: *"⚠️ AVISO: Lead respondendo diretamente na LOJA {{NOME}} (Inbox {{INBOX_ID}})"*, eliminando a sensação de mensagem sem nexo.

### Pilar 3: Resolução Blindada de URL do Chatwoot nas Recuperações de Leads
- **Extração Robusta de `convId`:**
  - Cadeia de fallback em `lead_reply_notifier.js`:
    ```javascript
    const convId = payload.conversation?.id || 
                   payload.conversation_id || 
                   payload.id || 
                   payload.meta?.conversation?.id;
    ```
  - Se ainda assim o ID não estiver presente no payload do evento, realiza consulta leve e síncrona na API do Chatwoot (`/api/v1/accounts/1/conversations?q=${cleanPhone}`) para obter o ID da conversa aberta antes de montar o texto.
- **Link Direto e Clickável Obrigatório:**
  - Garantia de que a URL `https://chat.tork.services/app/accounts/1/conversations/:id` esteja sempre preenchida com um número válido antes do envio.

---

## 3. Contratos de Dados e Templates Padronizados

### 3.1. Alerta de SLA 5 Minutos da Central (Padrão Rei do Módulo)
```text
🚨 *[ATENDIMENTO CENTRAL] ALERTA DE SLA (5 MIN)*

⚠️ *Cliente aguardando resposta da Kamila / Central há 5 minutos!*

• *Cliente:* Carlos Eduardo
• *Telefone:* `+55 11 97123-4567`
• *Horário da Mensagem:* 15:10:22
• *Tempo de Espera:* ⏱️ 5 min

💬 *Última Mensagem do Cliente:*
"Boa tarde, vocês têm horário para trocar o óleo e pastilha hoje ainda?"

🎯 *Classificação:* Dúvida / Orçamento (Triagem Automática)

📲 *Clique para Responder no WhatsApp:*
👉 https://wa.me/5511971234567

💻 *Abrir no Chatwoot:*
👉 https://chat.tork.services/app/accounts/1/conversations/4582
```

### 3.2. Alerta de Recuperação de Lead da Central (Instância Atendimento)
```text
🎯 *[RECUPERAÇÃO DE LEAD | INSTÂNCIA ATENDIMENTO]*

🎉 *Lead reativado respondeu no WhatsApp da Central!*

• *Cliente:* Adriana Melo da Silva
• *Veículo:* Evoque | *Placa:* FWP2D55
• *Telefone:* `+55 11 94146-0636`
• *Última Passagem:* janeiro

💬 *Mensagem do Lead:*
"Olá Camila, gostaria de agendar uma revisão pro meu carro."

💻 *Abrir no Chatwoot (Atendimento Imediato):*
👉 https://chat.tork.services/app/accounts/1/conversations/3910

📲 *Abrir no WhatsApp:*
👉 https://wa.me/5511941460636
```

### 3.3. Alerta de Lead Respondendo em Loja Física (Roteado ao Gerente)
```text
📍 *[RECUPERAÇÃO DE LEAD | LOJA MAUÁ]*

🎉 *Lead da campanha respondeu no WhatsApp da sua unidade!*

• *Cliente:* Fernando Souza
• *Veículo:* Corolla | *Placa:* EEE1234
• *Telefone:* `+55 11 98888-9999`
• *Gerente Responsável:* Marcelo Ribeiro

💬 *Mensagem do Lead:*
"Boa tarde, ainda estão fazendo aquela promoção de amortecedor?"

💻 *Abrir no Chatwoot:*
👉 https://chat.tork.services/app/accounts/1/conversations/4120

📲 *Abrir no WhatsApp:*
👉 https://wa.me/5511988889999
```

---

## 4. Matriz de Riscos & Mitigações

| Risco | Impacto | Mitigação Arquitetural |
|---|---|---|
| **Falsos Positivos de SLA na Central** | Médio | Filtro determinístico via `triage_regex_shield.js`: mensagens como "valeu", "show", "obrigado" são descartadas em <1ms sem armar cronômetro. |
| **Conversa Sem ID no Webhook** | Alto | Fallback automático consultando a API do Chatwoot pelo telefone antes de enviar o alerta, garantindo que o link nunca saia como `undefined`. |
| **Envio para Número Não Autorizado** | Crítico | Validação estrita por software: apenas `hydra` (`5511917837618`) é autorizada como remetente. O telefone do gerente de loja NUNCA pode ser remetente. |
| **Sobrecarga de Alertas no WhatsApp da Central** | Médio | Cooldown de 45 minutos no Redis por conversa (`central_sla:alerted:<convId>`), impedindo mensagens repetitivas se a atendente já estiver em atendimento. |

---

## 5. Próximo Passo
Aguardando aprovação via `/vibe-apply 053-central-sla-lead-recovery-routing` para início da implementação.
