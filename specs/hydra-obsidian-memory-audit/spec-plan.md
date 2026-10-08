# Spec-Plan — Hydra: Auditoria do Obsidian por Número, Memória e Interpretação

**Data:** 02 de Outubro de 2026  
**Status:** PLANEJAMENTO / SPEC-PLAN (SDD Proposal)  
**ID da Spec:** `hydra-obsidian-memory-audit`  

---

## 1. Visão Geral e Estrutura de Execução

Este plano operacional detalha as tasks atômicas para a execução das etapas **E0 a E6**, distribuídas de forma balanceada entre os três executores e coordenadas pelo Agente Principal. A implantação no ambiente de produção é estritamente condicionada à aprovação prévia nos gates de qualidade.

```
E0: Inventário & Manifesto ➔ E1: Correção do Roteamento (A01) ➔ E2: Vault por Identidade (A02/A03) ➔ E3: Unificação da Memória (A04/A09) ➔ E4: Histórico & Traces Reais (A05/A06) ➔ E5: Diagnóstico & Consolidação (A07/A10) ➔ E6: Suíte M01-M18 & Replay
```

---

## 2. Detalhamento das Etapas e Tasks Atômicas

### Etapa E0 — Inventário, Baseline e Manifesto de Execução
*Meta: Mapear dependências, isolar ambientes de trabalho na VPS, criar contratos tipados congelados e verificar os locks ativos das sessões.*

- [x] `[E0-P01]` **[PRINCIPAL]** Criar o *Manifesto de Execução* definindo o ambiente autorizado (branches `feat/...`, checkouts isolados, worktrees na VPS) e verificando os locks/PIDs das 3 sessões existentes.
- [x] `[E0-P02]` **[PRINCIPAL]** Criar o arquivo de tipos base `src/hydra-sync/types/vault_contract.ts` com as interfaces compartilhadas (`VaultFrontmatter`, `VaultNote`, `VaultDiagnosticsResult`, `RuntimeDiagnosticsPayload`, `ConversationHistoryQuery`, `ConversationHistoryResult`, `ToolCallTrace`).
- [x] `[E0-E1]` **[EXECUTOR 1]** Inspecionar e mapear as cláusulas de pré-roteamento em `intent_rewriter.ts` (especificamente linhas 1750-1800 e 2480-2520) identificando todos os pontos de substring matching.
- [x] `[E0-E2]` **[EXECUTOR 2]** Inspecionar o diretório `/home/operacional/hydra-data/` na VPS, verificando permissões de escrita para a criação da raiz de vault `/home/operacional/hydra-data/vault/`.
- [x] `[E0-E3]` **[EXECUTOR 3]** Analisar os registros brutos dos turnos 833 a 838 na tabela `agent_interaction_logs` do SQLite e preparar os payloads de entrada sanitizados para o replay de teste.

---

### Etapa E1 — Correção Imediata da Classificação de Intenção (A01)
*Meta: Eliminar o desvio de "obsidian", "diagnóstico" e "diário" para listagem de pátio em `intent_rewriter.ts`.*

- [x] `[E1-E1.1]` **[EXECUTOR 1]** Refatorar a condição de veículos retidos em `src/hydra-sync/intent_rewriter.ts`: remover completamente `norm.includes('dia') && !norm.includes('bom dia')`.
- [x] `[E1-E1.2]` **[EXECUTOR 1]** Implementar regra de gramática contextual para pátio: exigir termos explícitos de envelhecimento/tempo (`dias parado`, `retido há X dias`, `veículos no pátio`) combinados com entidade de oficina/loja.
- [x] `[E1-E1.3]` **[EXECUTOR 1]** Adicionar rotas prioritárias de classificação para pedidos meta-operacionais (`INTENT_RUNTIME_DIAGNOSTICS`, `INTENT_CONVERSATION_HISTORY`, `INTENT_MEMORY_PREFERENCE`).
- [x] `[E1-P]` **[PRINCIPAL]** Validar o isolamento léxico da correção: certificar que palavras como "obsidian", "diagnóstico", "diário" e "bom dia" não ativem a rota de pátio em nenhum cenário.

---

### Etapa E2 — Implementação do Vault Obsidian por Número (A02, A03)
*Meta: Criar a camada durável de notas Markdown Obsidian em `/home/operacional/hydra-data/vault/usuarios/<phone>/` com sincronização e índice SQLite.*

- [x] `[E2-E2.1]` **[EXECUTOR 2]** Implementar o driver de armazenamento `src/hydra-sync/vault_manager.ts`: criação segura de diretórios por telefone canônico, gravação atômica two-phase via arquivo temporário e validação rigorosa de path traversal.
- [x] `[E2-E2.2]` **[EXECUTOR 2]** Implementar serializador e parser de Frontmatter YAML para notas Markdown em `vault_manager.ts`, validando todos os campos do contrato `VaultFrontmatter`.
- [x] `[E2-E2.3]` **[EXECUTOR 2]** Criar tabela `hydra_vault_index` e triggers de sincronização no SQLite para espelhar as notas do vault, mantendo hash SHA-256 e versão.
- [x] `[E2-E2.4]` **[EXECUTOR 2]** Implementar rotina de reconciliação na inicialização (`syncVaultWithIndex`): varre o diretório do usuário, reindexa notas ausentes e limpa referências obsoletas sem perder dados.
- [x] `[E2-P]` **[PRINCIPAL]** Testar escrita, leitura e integridade física de uma nota de teste no filesystem da VPS, confirmando compatibilidade com o formato Obsidian.

---

### Etapa E3 — Unificação da Memória Persistente para Sócio e Gerente (A04, A09)
*Meta: Habilitar o ciclo completo de extração, validação de evidência e persistência de memórias para ambos os perfis, corrigindo substituições de escopo.*

- [x] `[E3-E2.1]` **[EXECUTOR 2]** Atualizar `src/hydra-sync/memory_repository.ts` para unificar a função de persistência: validar se o trecho de evidência (`evidence_text`) está comprovadamente presente na mensagem original do operador antes de persistir.
- [x] `[E3-E2.2]` **[EXECUTOR 2]** Ajustar a lógica de substituição por correção (`memoryType === 'correction'`): buscar registros anteriores com filtro estrito quíntuplo `(phone, generation_id, scope_type, loja_slug, topic_key)`, garantindo que uma correção na loja A não invalide a preferência da loja B do mesmo operador.
- [x] `[E3-E2.3]` **[EXECUTOR 2]** Sanear `src/hydra-sync/memory_retriever.ts`: desativar o JOIN vetorial cego sem cálculo de distância; unificar filtros de expiração temporal em formato ISO padronizado.
- [x] `[E3-E1]` **[EXECUTOR 1]** Conectar a chamada de persistência de memórias no fluxo de Sócio em `src/hydra-sync/agent_dispatcher.ts` (atualmente restrita ao fluxo de Gerente na linha 986).
- [x] `[E3-P]` **[PRINCIPAL]** Validar o fluxo pontual: Sócio declara preferência explícita -> nota gravada no vault -> SQLite indexado -> recuperação posterior traz a preferência com sucesso.

---

### Etapa E4 — Histórico Conversacional Estruturado e Telemetria Factual de Ferramentas (A05, A06)
*Meta: Permitir consulta precisa a perguntas de histórico e eliminar a etiquetagem indevida de ferramentas.*

- [x] `[E4-E3.1]` **[EXECUTOR 3]** Criar o serviço `src/hydra-sync/conversation_history_service.ts`: implementar consultas SQL estruturadas à tabela `conversation_messages` por telefone canônico com filtros de sessão, dia e geração.
- [x] `[E4-E3.2]` **[EXECUTOR 3]** Implementar a lógica exata para a pergunta *"qual foi a minha primeira pergunta?"*: retornar o registro mais antigo da sessão atual ou desambiguar caso haja múltiplos períodos materiais, sem nunca chutar a partir da janela de 4 mensagens.
- [x] `[E4-E3.3]` **[EXECUTOR 3]** Criar `src/hydra-sync/tool_execution_tracker.ts`: interceptar as chamadas reais aos adaptadores e workers MCP, gravando `toolsCalled` estritamente quando houver execução comprovada.
- [x] `[E4-E1]` **[EXECUTOR 1]** Remover a injeção estática e incondicional de `'mcp:hydra-ops'` em `src/hydra-sync/agent_dispatcher.ts:602`, conectando o `tool_execution_tracker`.
- [x] `[E4-P]` **[PRINCIPAL]** Replay do turno 838: validar que perguntas puramente conceituais não recebam mais a etiqueta `'mcp:hydra-ops'`.

---

### Etapa E5 — Diagnóstico Factual de Runtime e Agendamento de Consolidação (A07, A10)
*Meta: Fornecer respostas transparentes sobre o estado da memória/vault e ativar a rotina de consolidação com checkpoints auditáveis.*

- [x] `[E5-E1]` **[EXECUTOR 1]** Implementar `src/hydra-sync/runtime_diagnostics.ts`: função determinística que inspeciona o filesystem do vault, contagem de memórias no SQLite, geração ativa e conector MCP, gerando balão semântico transparente.
- [x] `[E5-E1]` **[EXECUTOR 1]** Atualizar `semantic_prompt.ts` e `system_prompt.md`: instruir o modelo a utilizar os dados de `runtime_diagnostics` para responder sobre o próprio bot, proibindo autodescrições sem evidência do servidor.
- [x] `[E5-E2]` **[EXECUTOR 2]** Configurar o agendamento observável das rotinas de consolidação em `memory_consolidator.ts` com gravação de checkpoints em `hydra_memory_consolidation_checkpoints` e execução garantida com zero tokens de LLM e zero WhatsApp.
- [x] `[E5-P]` **[PRINCIPAL]** Replay do turno 835: validar que a pergunta *"o seu obsidian ta funcionando? como tsua memoria"* retorna o diagnóstico factual do vault sem alucinações.

---

### Etapa E6 — Suíte Integrada M01 a M18, Replay e Gates de Qualidade
*Meta: Consolidar todos os patches, rodar a suíte completa com 100% de aprovação e certificar o build gate estrito.*

- [x] `[E6-E3.1]` **[EXECUTOR 3]** Implementar o Test Harness completo em `src/hydra-sync/tests/test_harness_obsidian_memory.ts` cobrindo todos os cenários M01 a M18 com banco isolado e filesystem temporário.
- [x] `[E6-E3.2]` **[EXECUTOR 3]** Executar o Replay dos turnos reais 833 a 838 no test harness, comprovando a correção de cada comportamento anômalo registrado na auditoria.
- [x] `[E6-P01]` **[PRINCIPAL]** Integrar os patches dos três executores na branch base de integração e rodar o build gate estrito: `npx tsc --project tsconfig.hydra.json --noEmit` (Código 0).
- [x] `[E6-P02]` **[PRINCIPAL]** Executar a suíte de regressão T01 a T28 da release anterior, garantindo zero impacto sobre as regras operacionais já homologadas.
- [x] `[E6-P03]` **[PRINCIPAL]** Executar a suíte M01 a M18 na worktree integrada, certificando 100% PASS.
- [x] `[E6-P04]` **[PRINCIPAL]** Elaborar o manual de reversão (rollback plan) e registrar as instruções de migração aditiva para ativação segura.

---

## 3. Manifesto de Execução (Contrato Inicial E0)

1. **Ambiente Autorizado:**
   - Todo o desenvolvimento deve ocorrer em worktrees isoladas na VPS ou em checkouts locais na branch `feat/hydra-obsidian-memory-audit`.
   - Proibido mutar `/opt/bots/` ou `/home/operacional/hydra/` durante o apply.
   - Proibido enviar mensagens para números fora da whitelist de testes.
2. **Propriedade Única de Arquivos:**
   - **Executor 1:** `src/hydra-sync/intent_rewriter.ts`, `src/hydra-sync/runtime_diagnostics.ts`, `src/hydra-sync/semantic_prompt.ts`, `src/hydra-sync/agent_dispatcher.ts` (camada de intenção/prompt).
   - **Executor 2:** `src/hydra-sync/vault_manager.ts`, `src/hydra-sync/memory_repository.ts`, `src/hydra-sync/memory_retriever.ts`, `src/hydra-sync/memory_consolidator.ts`.
   - **Executor 3:** `src/hydra-sync/conversation_history_service.ts`, `src/hydra-sync/tool_execution_tracker.ts`, `src/hydra-sync/tests/test_harness_obsidian_memory.ts`.
   - **Principal:** `src/hydra-sync/types/vault_contract.ts`, coordenação, gates e integração.
3. **Build Gates Obrigatórios:**
   - `npx tsc --project tsconfig.hydra.json --noEmit` (Código 0).
   - Suíte determinística M01 a M18 (100% PASS).
   - Replay aprovado dos turnos 833 a 838 com zero anomalias.
   - Suíte de regressão T01 a T28 (100% PASS).
4. **Mapeamento Estrito das Sessões dos Executores:**
   - **Executor 1 (Interpretação, Diagnóstico & Prompt):** Sessão `Hydra Operational Context Handoff` ([`de5452f5-ae9d-4de2-af64-0b12f075f5ea`](conversation://de5452f5-ae9d-4de2-af64-0b12f075f5ea))
   - **Executor 2 (Vault por Identidade, Armazenamento & Memória):** Sessão `Hydra Ecosystem Context Transfer` ([`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`](conversation://7b9923e9-f4d2-46ff-8a6b-ea932132e04d))
   - **Executor 3 (Traces Reais, Histórico & Harness M01-M18):** Sessão `Hydra Ecosystem Operational Handover` ([`5dffcfaf-5e84-438e-81f0-88558655f4c0`](conversation://5dffcfaf-5e84-438e-81f0-88558655f4c0))
