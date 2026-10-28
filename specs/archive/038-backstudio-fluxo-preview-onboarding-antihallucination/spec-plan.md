# Plano de Implementação: Reformulação da Esteira Comercial do Agente David (Backstudio)

**Spec ID:** `038-backstudio-fluxo-preview-onboarding-antihallucination`  
**Data:** 27/10/2026  
**Status:** Planejamento (SDD Proposal)  

---

## Fases de Execução

### Fase 1: Reformulação do System Prompt do David (Versão 9)
- [x] **[PROMPT-01]** Implementar a bifurcação estrita de jornada no prompt: Caminho COM Preview (`has_preview = true` e `demo_url` válida) vs Caminho SEM Preview (proibição de prometer demonstração pronta; qualificação e coleta de briefing para produção do zero).
- [x] **[PROMPT-02]** Expurgar 100% dos nomes hardcoded (`"Marcos"`, etc.) de todos os exemplos de few-shot, substituindo por tokens condicionais seguros `{{contact_name}}` com regra estrita de proibição de alucinação de nomes.
- [x] **[PROMPT-03]** Substituir a convenção legada de separação por pipe (`|`) por quebras duplas de linha (`\n\n`), alinhando com a engine de fatiamento nativa de bolhas do Deskcomm.
- [x] **[PROMPT-04]** Implementar a Trava Inegociável da Cobrança Asaas: inclusão obrigatória do link de pagamento (`invoice_url`) na resposta no mesmo turno em que a tool `Gerar_Cobranca_Asaas` retornar sucesso.
- [x] **[PROMPT-05]** Adicionar a máquina de estados conversacional do Onboarding Pós-Venda: coleta estruturada de domínio desejado (.com.br), Instagram/logotipo/fotos e alinhamento de prazo de entrega de 48h úteis após confirmação de pagamento.

### Fase 2: Configuração e Publicação no Supabase (DeskcommCRM)
- [x] **[DB-01]** Criar a nova versão do agente David (`version_number: 9`) na tabela `ai_agent_versions` com o novo `system_prompt` calibrado e ferramentas MCP vinculadas (`crm_*` + `Gerar_Cobranca_Asaas`).
- [x] **[DB-02]** Atualizar a tabela `ai_agents` apontando `published_version_id` para a versão 9 e incrementando `operation_revision`.
- [x] **[DB-03]** Adicionar e validar os campos customizados essenciais do lead (`has_preview`, `demo_url`, `dominio_desejado`, `instagram`, `onboarding_status`) no pipeline de vendas do Deskcomm.

### Fase 3: Blindagem Defensiva no Código e Sanitização de Mensagens
- [x] **[SANITY-01]** Inspecionar e validar `/opt/deskcomm/lib/agent-engine/agent/split-message.ts` para garantir que qualquer pipe residual seja sanitizado e que o split por `\n\n` entregue bolhas com espaçamento humano sem vazar caracteres técnicos no WhatsApp.
- [x] **[SANITY-02]** Validar trava de horário comercial no agendamento de follow-up (09:00 às 18:30 BRT) para prevenir disparos em horários inconvenientes (como às 07:00 AM).

### Fase 4: Testes de Validação e Verificação em Sandbox
- [x] **[TEST-01]** Executar teste simulado com lead SEM preview informando nicho de clínica estética: verificar se o bot NÃO alucina demo pronta e coleta briefing de criação.
- [x] **[TEST-02]** Executar teste simulado de fechamento e geração de cobrança: verificar se o link do Asaas é emitido e entregue na mensagem sem omissões.
- [x] **[TEST-03]** Executar teste simulado de aviso *"paguei"*: verificar se o bot dispara o protocolo de onboarding (domínio + Instagram + prazo 48h) em vez de silenciar.
- [x] **[TEST-04]** Verificar ausência de nomes inventados e ausência de pipes `|` nos textos gerados.
