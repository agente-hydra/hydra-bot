# Proposta: Cadastro de Admin Joacir, Broadcast Blindado para Grupo Mecânica TI e Liquidação D+1 no Relatório Matinal

**Spec ID:** `hydra-admin-group-and-settlement`  
**Data:** 08/10/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply hydra-admin-group-and-settlement`)  
**Base de Código:** Produção `/opt/bots/`, `/home/operacional/hydra/`, `/home/operacional/watchdog/` e repositório `projects/hydra-rede`

---

## 1. Problema e Motivação

1. **Gestão e Acompanhamento da Diretoria:**
   - O novo administrador **Joacir Barros** (`+55 11 94764-5967`) precisa de acesso irrestrito às operações do ecossistema Hydra:
     - Autorização de segurança como Sócio/Admin no SQLite WAL (`hydra_ops.db`), com permissão para dialogar no WhatsApp privado do Hydra (consultas de pátio, faturamento, OSs profundas e metas).
     - Recebimento dos relatórios diários matinais (Conciliação de Pátio & OS e Relatório de Juros e Taxas Rede).
     - Recebimento das análises de atendimento e alertas de falhas comerciais dos gerentes disparados pelo robô supervisor (Watchdog).

2. **Canal Centralizado de Notificações da Equipe (Grupo WhatsApp "Mecanica TI"):**
   - A diretoria criou o grupo oficial no WhatsApp **Mecanica TI** (`120363425738307789@g.us`) para consolidar a telemetria diária e as auditorias.
   - O grupo deve receber:
     - Análises e alertas de conversas dos gerentes (Watchdog).
     - Resumos diários executivos do Agente Hydra (Pátio matinal e Juros Rede).
   - **Requisito Crítico de Segurança (Zero Conversação / Read-Only):**
     - O Hydra bot **NUNCA deve interagir ou responder mensagens enviadas dentro deste grupo**. O grupo é estritamente um canal de transmissão unidirecional (broadcast). Ninguém pode conversar ou acionar o bot via grupo, evitando respostas públicas indevidas, poluição do canal ou vazamento acidental de consultas.

3. **Visibilidade Financeira de Curto Prazo (Liquidação D+1 Matinal):**
   - O relatório diário de Pátio & OS atualmente detalha o que foi recebido ontem por modalidade (Crédito, PIX, Débito, Dinheiro), mas não evidencia com clareza o fluxo de caixa imediato:
     - O financeiro e os sócios precisam saber exatamente **quanto das vendas de ontem (D-1) vai cair na conta hoje pela manhã** (principalmente cartões de débito D+1 e modalidades de liquidação no dia seguinte), contrastando com o que já entrou no caixa ontem (PIX e dinheiro).

---

## 2. Solução Proposta

### 2.1. Inclusão do Admin Joacir Barros no SQLite & Listas de Disparo
- Inserir na tabela `hydra_authorized_users` no banco de dados operacional `/home/operacional/hydra-data/hydra_ops.db`:
  - `phone`: `'5511947645967'`
  - `name`: `'Joacir Barros'`
  - `role`: `'socio'`
  - `allowed_stores`: `'["*"]'`
  - `is_active`: `1`
  - `can_simulate_persona`: `1`
- Atualizar as listas de destinatários nos orquestradores de envio:
  - `whatsapp_patio_dispatcher.js`: Adicionar `5511947645967` na lista de administradores/diretoria.
  - `whatsapp_notifier.js` (Hydra Rede): Adicionar `5511947645967` na lista de distribuição matinal.

### 2.2. Integração do Grupo WhatsApp "Mecanica TI" (`120363425738307789@g.us`)
- Adicionar o JID `120363425738307789@g.us` como destino de broadcast no:
  - **Watchdog Worker (`/home/operacional/watchdog/worker.js`):** Enviar alertas de falha de atendimento diretamente ao grupo via Evolution API (`/message/sendText/hydra`), além dos canais individuais.
  - **Hydra Pátio & Rede:** Enviar o resumo executivo e planilhas matinais diretamente ao grupo.
- **Barreira Blindada contra Mensagens de Grupo no Ingress (`identity_access_guard.ts` e `webhook-listener.js`):**
  - Implementar verificação estrita: se `rawRemoteJid.endsWith('@g.us')` ou se for identificado como mensagem de grupo, o webhook retorna imediatamente `HTTP 200 {"status": "ignored_group"}`:
    - Zero reação visual (sem 👀).
    - Zero indicação de presença (sem `composing`).
    - Zero alocação de LLM / workers.
    - Zero resposta no grupo.

### 2.3. Previsão de Liquidação de Vendas de Ontem para Hoje (D+1 Matinal)
- Estender `patio_ledger_engine.js` e `whatsapp_patio_dispatcher.js`:
  - Separar os pagamentos recebidos em D-1 por regra de liquidação:
    - **Caindo Hoje de Manhã (Liquidação D+1):** Total em Cartão de Débito (e eventuais vendas de crédito com antecipação D+1 configurada).
    - **Já Disponível no Caixa (D-1):** Total recebido via PIX e Dinheiro físico.
  - Adicionar bloco de destaque no texto do WhatsApp do relatório matinal das 08:00:
    ```text
    💵 PREVISÃO DE ENTRADA HOJE (MANHÃ):
    • 💳 Débito de Ontem (Caindo Hoje D+1): R$ X.XXX,XX
    • ⚡ Já Liquidado Ontem (Pix/Dinheiro): R$ Y.YYY,YY
    👉 Disponibilidade Imediata em Caixa: R$ Z.ZZZ,ZZ
    ```

---

## 3. Contratos de Dados & Segurança

- **Segurança Evolution API:** O envio para o grupo `120363425738307789@g.us` utiliza exclusivamente a instância permitida `hydra` (em conformidade estrita com a regra de nunca usar instâncias de gerentes).
- **Idempotência no SQLite:** A inserção do usuário `5511947645967` utiliza `INSERT ... ON CONFLICT(phone) DO UPDATE SET role='socio', is_active=1, can_simulate_persona=1` para garantir que novas migrações não quebrem o cadastro.
- **Isolamento de Grupo:** Mensagens recebidas com `remoteJid` terminado em `@g.us` são descartadas antes de qualquer avaliação de persona ou sessão.

---

## 4. Riscos Principais & Mitigações

1. **Risco:** O bot responder acidentalmente no grupo se alguém enviar uma mensagem marcando o bot ou com a palavra-chave de um comando.
   - **Mitigação:** Trava incondicional de primeiro nível no Ingress (`identity_access_guard.ts`): qualquer JID com `@g.us` é sumariamente rejeitado com retorno imediato.
2. **Risco:** Falha de envio para grupos se a Evolution API exigir payload específico.
   - **Mitigação:** O endpoint `/message/sendText/hydra` da Evolution API aceita nativamente o JID de grupo (`120363425738307789@g.us`) no campo `number`.
