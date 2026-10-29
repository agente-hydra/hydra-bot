# Plano de Execução (Spec-Plan): Unificação do SLA da Central (Padrão Rei do Módulo), Isolamento de Lojas e Links Chatwoot para Leads

**ID da Spec:** `053-central-sla-lead-recovery-routing`  
**Data:** 29/10/2026  
**Status:** CONCLUÍDO E TESTADO COM SUCESSO (8/8 PASS) — AGUARDANDO ARQUIVAMENTO (`/vibe-archive 053-central-sla-lead-recovery-routing`)  

---

## 1. Visão Geral das Tarefas

| Tarefa | Executor | Descrição | Arquivos Afetados | Gate de Validação |
|---|---|---|---|---|
| **Task 1** | `[LEAD]` | `[x] Completed` | Modernizar `central_sla.js` para SLA 5-Minutos com Triagem (Regex Shield) e template com `wa.me` + Chatwoot | `projects/hydra-watchdog/lib/central_sla.js`, `projects/hydra-watchdog/worker.js` | Teste unitário de SLA 5 min com descarte de cortesia ("valeu", "show") e presença de ambos os links |
| **Task 2** | `[LEAD]` | `[x] Completed` | Implementar extração robusta de `convId` com fallback via API do Chatwoot em `lead_reply_notifier.js` | `projects/hydra-watchdog/lib/lead_reply_notifier.js` | Teste unitário com payloads truncados garantindo zero links `undefined` |
| **Task 3** | `[PARALLEL: lead-routing]` | `[x] Completed` | Implementar isolamento e roteamento de leads por inbox de origem (Central vs Lojas Físicas) | `projects/hydra-watchdog/lib/lead_reply_notifier.js`, `projects/hydra-watchdog/gateway.js` | Resposta de lead em loja física roteia para o gerente e não contamina o número da Central |
| **Task 4** | `[LEAD]` | `[x] Completed` | Bateria de Testes Integrada da Central (SLA + Leads) | `projects/hydra-watchdog/test_central_sla_lead_pipeline.js` | 100% de aprovação (8 PASS / 0 FAIL) em todos os cenários de triagem, SLA e roteamento |
| **Task 5** | `[LEAD]` | `[x] Completed` | Build Gate (`node --check`), Auditoria de Remetente (`hydra`) e Hard Stop | Todos os arquivos alterados | Sintaxe 100% limpa, garantia de remetente `hydra` e Hard Stop |

---

## 2. Detalhamento Passo a Passo

### Task 1: Modernização do SLA da Central (`central_sla.js`)
- Alterar `CENTRAL_SLA_SECONDS` de 600 (10 min) para 300 (5 min).
- Importar e acoplar `evaluateRegexShield` e `isOnlyClosings` de `./triage_regex_shield`:
  - Se a mensagem do cliente for apenas fechamento/cortesia, cancela o timer e desconsidera.
  - Se contiver dúvida ou áudio, arma o timer no ZSET `central_sla:pending` com score `waitingSince + 300`.
- Reescrever `buildCentralSlaNotification`:
  - Incluir cabeçalho destacado `🚨 *[ATENDIMENTO CENTRAL] ALERTA DE SLA (5 MIN)*`.
  - Exibir cliente, telefone, horário, tempo de espera e citação da mensagem.
  - Incluir obrigatoriamente **ambos os links**: `https://wa.me/55...` E `https://chat.tork.services/app/accounts/1/conversations/:id`.

### Task 2: Extração Resiliente de `convId` e Link Chatwoot para Leads
- Em `lead_reply_notifier.js`:
  - Criar função `resolveChatwootConversationId(payload)` cobrindo `payload.conversation?.id`, `payload.conversation_id`, `payload.id` e `payload.meta?.conversation?.id`.
  - Se ausente, invocar fallback `fetchActiveConversationId(cleanPhone)` consultando a API do Chatwoot.
  - Atualizar `buildCentralLeadAlert` para garantir o link no formato:
    `💻 *Abrir no Chatwoot (Atendimento Imediato):* 👉 https://chat.tork.services/app/accounts/1/conversations/:id`

### Task 3: Isolamento de Escopo e Roteamento de Leads por Inbox
- Ajustar `gateway.js` para passar `inboxId` na chamada: `handlePossibleLeadReply(payload, { inboxId })`.
- Em `lead_reply_notifier.js`:
  - Se `inboxId === 1 || inboxId === 16` (Central): despacha para `CENTRAL_ATENDIMENTO_PHONE` com tag `[RECUPERAÇÃO DE LEAD | INSTÂNCIA ATENDIMENTO]`.
  - Se `inboxId >= 2 && inboxId <= 10` (Loja Física): consulta `store_router.getStoreInfo(inboxId)` e despacha para o telefone do gerente da loja (`store.phone`), com tag `[RECUPERAÇÃO DE LEAD | LOJA {{NOME}}]`.
  - Impede incondicionalmente que leads respondendo a lojas físicas sejam despachados para a Central sem identificação de loja.

### Task 4: Bateria de Testes Integrada (`test_central_sla_lead_pipeline.js`)
- Criar suíte de testes cobrindo:
  1. Cliente da Central manda "valeu" -> SLA não arma.
  2. Cliente da Central manda dúvida -> SLA arma para 5 min; após 300s dispara alerta com link `wa.me` E link do Chatwoot.
  3. Lead responde na Inbox 1 (Central) -> Alerta entregue na Central com link do Chatwoot válido (sem `undefined`).
  4. Lead responde na Inbox 9 (Mauá) -> Alerta roteado para o gerente de Mauá (`5511984324928`), zero contaminação na Central.
  5. Trava de remetente: erro caso o remetente não seja `hydra`.

### Task 5: Build Gate & Hard Stop
- Executar `node --check` em todos os arquivos modificados.
- Validar conformidade de segurança.
- **HARD STOP:** Apresentar relatório e aguardar `/vibe-apply 053-central-sla-lead-recovery-routing`.

---

## 3. Protocolo de Rollback e Segurança
- Caso ocorra qualquer inconsistência no roteamento de lojas, o sistema mantém fallback seguro para `CENTRAL_ATENDIMENTO_PHONE` com aviso explícito de loja externa.
- Trava de remetente incondicional: erro fatal se `sender !== 'hydra'`.
