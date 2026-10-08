# Proposta: Alinhamento e Roteamento Seguro de Instâncias Evolution API (MCP Leads)

## 1. Contexto e Evidência Real do Problema

### O que ocorreu (Diagnóstico do Commit 8094ac0 e Logs Operacionais):
1. **Colisão de Webhooks da Instância `atendimento`:**
   - O WhatsApp `atendimento` (`5511917698769`) é a Central de Atendimento ao Cliente da Mecânica Popular.
   - O `webhook-listener.js` do Hydra Bot estava recebendo mensagens de clientes da oficina vindas de `atendimento`.
   - O outro agente adicionou a **Barreira -1** no commit `8094ac0` para rejeitar webhooks da instância `atendimento`, blindando o bot interno do Hydra (`5511917837618`) contra mensagens de clientes.
2. **Hardcoding de Instância no MCP Lead Tools:**
   - Em `src/hydra-sync/mcp_lead_tools.ts` (linhas 389 e 558), o envio de notificações para gerentes foi fixado diretamente com `new WhatsAppClient({ instance: 'atendimento' })`.
   - No arquivo `.env`, existe a variável `EVOLUTION_LEAD_INSTANCE=atendimento`, mas o código em `mcp_lead_tools.ts` não a consultava de forma flexível.
3. **Risco de Vazamento Cruzado:**
   - Quando o Hydra dispara notificações pelo WhatsApp `atendimento`, essas mensagens aparecem na caixa de entrada do Chatwoot da Central de Atendimento.
   - Se um gerente responder à mensagem de notificação, a resposta cai no WhatsApp da Central de Atendimento e pode ser interceptada pelo bot de atendimento a clientes.

---

## 2. Solução Proposta

### Ação 0 (Segurança Crítica): Trava Programática Absoluta contra Instâncias de Gerentes
- **Regra:** É terminantemente proibido disparar qualquer mensagem (teste, automação ou produção) através de instâncias de gerentes (`Maua`, `Jorge Beretta`, `Kennedy`, etc.).
- **Implementação:** Definir no núcleo de `WhatsAppClient` (`whatsapp_client.ts` e `whatsapp_client.js`) o conjunto estrito `ALLOWED_SENDER_INSTANCES = new Set(['hydra', 'atendimento'])`.
- O método de envio (`sendText` e `sendPresence`) valida a instância contra a whitelist e lança erro fatal imediato se não for permitida, abortando antes de qualquer requisição HTTP.
- Nenhuma nova instância poderá ser usada sem autorização prévia expressa por escrito do usuário e nunca poderá ser de gerente.

### Ação 1: Roteamento Configurável e Desacoplado via Variável de Ambiente
Em vez de fixar `'atendimento'` ou `'hydra'` no código:
- Ler `getLeadNotificationInstance()` alimentada por `process.env.EVOLUTION_LEAD_INSTANCE`.
- Permitir alternar a instância de envio dos gerentes sem alterar código, apenas via `.env`.

### Ação 2: Validação da Instância Destinada a Notificações de Gerentes
Alinhar com o usuário qual das duas instâncias oficiais deve ser o remetente oficial das mensagens aos gerentes:
- **Opção 1 (`hydra` - 5511917837618):** O próprio bot operacional Hydra avisa os gerentes. Vantagem: isolamento total da Central de Atendimento, sem gerar tickets no Chatwoot de clientes.
- **Opção 2 (`atendimento` - 5511917698769):** A Central de Atendimento envia o aviso para o gerente. Vantagem: o gerente vê a mensagem vindo do canal oficial da Central.

### Ação 3: Auditoria do Registro e Status da Notificação
Garantir que a coluna `instancia_emissora` no SQLite registre com precisão a instância efetivamente utilizada no envio, garantindo rastreabilidade no banco e nos logs do PM2.

