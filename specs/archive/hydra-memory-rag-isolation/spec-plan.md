# Plano de Execução — Memória Estruturada, RAG Seguro e Isolamento Rigoroso (Revisado)

## [PRE-INTEGRAÇÃO] Contratos Compartilhados e Migrações Idempotentes (Agente Principal)
- [x] Criar arquivo de tipos compartilhados `src/hydra-sync/types/access_contract.ts` com interfaces `AuthorizedUser`, `PhoneIdentityMapping`, `AuthorizedContext` e `SecurityRejectionLog`.
- [x] Criar arquivo de tipos compartilhados `src/hydra-sync/types/memory_contract.ts` com interfaces `MemoryRecord`, `MemoryCandidate`, `MemoryRetrievalFilter` e `MemoryRetrievalResult`.
- [x] Criar migração SQLite aditiva e idempotente em `src/hydra-sync/db_repository.ts`:
  - `hydra_authorized_users`
  - `hydra_phone_identities`
  - `hydra_memories`
  - `hydra_memory_consolidation_checkpoints`
  - `hydra_security_rejections`
- [x] Popular `hydra_authorized_users` via seed idempotente com `ON CONFLICT(phone) DO NOTHING`:
  - Davi (`5511996242812`): `role = 'socio'`, `allowed_stores = '["*"]'`, `can_simulate_persona = 1`, `is_active = 1`.
  - Marcos (`5511970671717`): `role = 'socio'`, `allowed_stores = '["*"]'`, `can_simulate_persona = 1`, `is_active = 1`.
  - Garantir que reexecuções de seed nunca reativem usuários revogados (`is_active = 0`).

---

## [AGENTE 1] Acesso por Número, Sessão e Janela de Contexto

### 1.1. Barreira de Acesso e Autenticação de Webhook
- [/] In Progress: Implementar `src/hydra-sync/identity_access_guard.ts`:
  - `authenticateWebhookRequest(headers: Record<string, string>): { ok: boolean; reason?: string }`:
    * Se `EVOLUTION_WEBHOOK_SECRET` estiver configurado, valida o secret recebido.
    * Se não estiver configurado, aceita a requisição em modo de compatibilidade com log operacional sanitizado.
  - `resolveCanonicalIdentity(db, payload): Promise<AuthorizedContext | null>`:
    * Resolução auditada de `remoteJid` para `phoneCanonical` consultando `hydra_phone_identities`.
    * Checagem em `hydra_authorized_users` garantindo `is_active === 1`.
  - `recordSecurityRejection(db, rejectionLog)` para auditoria de bloqueios.
- [/] In Progress: Ajustar `webhook-listener.js`:
  - Posicionar a barreira de acesso antes de qualquer chamada a fila, presença, reação, download de mídia, transcrição ou IA.
  - Para não cadastrados, retornar imediatamente HTTP 200 `{ status: "ignored_unauthorized" }`, sem enviar mensagem WhatsApp nem gravar texto no histórico.
  - Bloquear download de mídia no Ingress para remetentes não autorizados.

### 1.2. Revalidação Contínua e Segregação de Simulação
- [/] In Progress: Separar cadastro de acesso ao bot (`hydra_authorized_users`) da permissão para simulação de perfil (`can_simulate_persona === 1`).
- [/] In Progress: Em `command_interceptor.ts`, rejeitar `/socio`, `/reset` e `/{loja}` para usuários sem `can_simulate_persona === 1`, mesmo que autorizados no bot.
- [/] In Progress: Adicionar revalidação de autorização no consumo da fila (`executeChatQueue`), na execução de ferramentas e antes do envio de balões (`sendSequentialReplies`): abortar se o usuário foi desativado em voo.

### 1.3. Sessão, Fila e TTL Preservados
- [/] In Progress: Preservar a cadência operacional já validada:
  - Debounce de encavalamento mantido em **1.500 ms de silêncio** e **teto máximo de 5.000 ms**.
  - TTL de contexto mantido em **120 minutos**.
- [/] In Progress: Em `turn_context_repository.ts`, isolar rigorosamente o debounce, estado de OS e histórico por `phone` canônico.
- [/] In Progress: Blindar o comando `/reset`:
  - Incrementar `memory_generation` no perfil.
  - Limpar `hydra_turn_contexts` e abortar jobs em voo.
  - Garantir que memórias de gerações antigas sejam marcadas ou ignoradas nas consultas subsequentes.

### 1.4. Testes Automatizados da Frente 1
- [/] In Progress: Criar `src/hydra-sync/tests/test_harness_access_session.ts`:
  - Rejeição silenciosa de remetente não cadastrado (zero IA, zero mídia, zero reação, zero WhatsApp).
  - Webhook autenticado legítimo continuando a funcionar após migração (modo compatível e modo com secret).
  - Usuário revogado permanecendo revogado após reexecutar migração/seed (`ON CONFLICT DO NOTHING`).
  - Mapeamento confiável de LID para PN sem duplicar identidade.
  - Bloqueio de simulação de perfil para usuário sem `can_simulate_persona`.
  - Revalidação em voo (usuário desativado enquanto o job está na fila de espera).
  - Isolamento de dois números conversando concorrentemente.
  - Preservação dos parâmetros de 1.500ms de debounce e 120min de TTL.
  - Execução de `/reset` incrementando geração e abortando trabalho ativo.

---

## [AGENTE 2] Memória Estruturada e Consolidação sem LLM

### 2.1. Repositório de Memória Atômica e Validação Equilibrada
- [/] In Progress: Implementar `src/hydra-sync/memory_repository.ts`:
  - `saveMemoryRecord(db, record)` e `updateMemoryStatus(db, memoryId, status)`.
  - `getMemoriesByTopic(db, filter: MemoryRetrievalFilter)`: aplicando o escopo efetivo completo (gerente bloqueia rede!).
  - `invalidateGenerationMemories(db, phone, oldGenerationId)`.
  - `validateAndPersistMemoryCandidates(db, candidates, context)`:
    * Validador determinístico anti-alucinação: rejeitar sentenças que associam valores monetários concretos a entidades transitórias (`os_id`, `placa`, saldos).
    * Aceitar preferências legítimas contendo "faturamento", "%" e números (ex: "prefiro faturamento antes de OS", "mostre CMV em %", "retidos significa mais de 5 dias").
    * Confiança $\ge 0.8$ do modelo NÃO promove inferência a preferência confirmada. Interesses derivados permanecem como `derived_interest`.

### 2.2. Schema de Extração no Revisor de IA
- [/] In Progress: Ajustar `src/hydra-sync/semantic_prompt.ts`:
  - Formular diretrizes no prompt do revisor para emitir `candidatosMemoria?: MemoryCandidate[]` no mesmo JSON.
  - Orientar a classificação estrita: `explicit_preference` (quando o usuário declara diretamente), `correction` (quando o usuário corrige um termo) e `derived_interest` (quando o usuário consulta repetidamente um assunto).
  - Proibir explicitamente a extração de dados contábeis/financeiros voláteis para a memória.
- *(Nota de Propriedade: `agent_dispatcher.ts` será editado exclusivamente pelo Agente Principal no momento da integração final).*

### 2.3. Motor de Consolidação sem LLM
- [/] In Progress: Implementar `src/hydra-sync/memory_consolidator.ts`:
  - Agrupamento pela chave quíntupla completa: `(phone, generation_id, scope_type, loja_slug, topic_key)`.
  - Deduplicação estável por `source_turn_ids`: reexecutar jobs ou retries de webhook não incrementa contadores.
  - Janelas completas via watermark em `hydra_memory_consolidation_checkpoints` no fuso `America/Sao_Paulo`.
  - Rotina Diária: agrupa candidatos, aplica substituições (`superseded`) para correções explícitas e atualiza `distinct_days_json`.
  - Rotina Semanal: exige $\ge 2$ dias distintos na semana para qualificar `derived_interest` como estável; aplica decaimento em interesses com 1 dia só.
  - Blindagem contra jobs atrasados pós-reset: valida se `generation_id` ainda é a geração ativa antes de commitar.
  - **Garantia Arquitetural:** 0 chamadas a APIs de LLM e 0 mensagens enviadas ao WhatsApp.

### 2.4. Testes Automatizados da Frente 2
- [/] In Progress: Criar `src/hydra-sync/tests/test_harness_memory_consolidation.ts`:
  - Extração piggyback no revisor sem chamadas extras de IA.
  - Aceitação de preferências legítimas contendo %, números e "faturamento".
  - Rejeição de fatos operacionais voláteis concretos (saldo de OS, faturamento realizado).
  - Confiança $\ge 0.8$ mantendo classificação como `derived_interest` sem promoção indevida.
  - Mesmo número, duas lojas e mesmo tópico (garantir que não se misturam).
  - Precedência de correção explícita substituindo versão anterior (`superseded`).
  - Repetição de evento/job sem aumentar frequência (`source_turn_ids`).
  - Consolidação diária e semanal com watermark em `America/Sao_Paulo` (zero chamadas LLM e zero WhatsApp).
  - Reset durante consolidação descartando commits atrasados da geração antiga.

---

## [AGENTE 3] Recuperação/RAG, Briefings e Harness Integrado

### 3.1. Motor de Recuperação e RAG com Escopo Efetivo
- [/] In Progress: Implementar `src/hydra-sync/memory_retriever.ts`:
  - `retrieveActiveMemories(db, filter: MemoryRetrievalFilter): Promise<MemoryRetrievalResult>`:
    * Se `effectivePersona === 'gerente'`: filtra estritamente por `(scope_type = 'loja' AND loja_slug = :activeLoja) OR scope_type = 'perfil_global'`. **Zero memórias de rede permitidas!**
    * Se `effectivePersona === 'socio'`: filtra por `scope_type = 'rede' OR scope_type = 'perfil_global'`.
    * Pré-filtros SQL obrigatórios: `phone`, `generation_id`, `status = 'active'`, `expires_at > now`.
  - Formatação concisa de no máximo 3 memórias ativas (<150 tokens) para injeção no prompt do revisor.
  - Busca estruturada direta como primeira camada ultra-rápida (<5ms).
  - Complemento vetorial opcional (tabela `vec_user_memory` particionada por `phone` e `generation_id`) com fallback gracioso instantâneo para a busca estruturada se o módulo vetorial falhar.

### 3.2. Briefings Adaptativos com Fontes Oficiais
- [/] In Progress: Ajustar `src/hydra-sync/ai_briefing.ts`:
  - Consultar memórias consolidadas ativas do destinatário via `memory_retriever.ts` respeitando seu escopo.
  - Priorizar a ordem das seções no briefing com base em tópicos de interesse confirmados (ex: CMV de óleo, OS aguardando peça), alimentando-se sempre dos dados mais atualizados no banco.
  - Revalidar cadastro do destinatário antes do envio: cancelar disparo se usuário estiver inativo.
  - Preservar o perfil e escopo do destinatário sem alterar a sessão interativa do usuário.

### 3.3. Test Harness Unificado e Matriz de Aceitação
- [/] In Progress: Criar `src/hydra-sync/tests/test_harness_unified.ts`:
  - Suíte completa em 6 camadas (`access`, `session`, `memory`, `retrieval`, `briefing`, `integration`).
  - Cobertura integral dos 28 cenários da Matriz de Aceitação obrigatória.
  - Provas explícitas exigidas:
    * Sócio $\to$ gerente sem recuperação de memória da rede.
    * Mesmo número, duas lojas e mesmo tópico sem colisão.
    * Reset durante consolidação e indexação com descarte de saídas atrasadas.
    * Repetição de evento/job sem aumentar contadores.
    * Preferências legítimas contendo %, números e "faturamento".
    * Webhook autenticado legítimo funcionando após migração.
    * Usuário revogado permanecendo revogado após reexecutar migração.
  - Spies nos pontos críticos: chamadas de IA (garantir zero chamadas na consolidação), Evolution API (garantir zero envios para bloqueados), banco e filesystem.

---

## [INTEGRAÇÃO PRINCIPAL] Validação, Build Gate e Implantação (Agente Principal)
- [ ] Integrar os patches das 3 frentes na branch de staging `feat/hydra-memory-rag-integrated`.
- [ ] Conectar o ponto único de injeção em `src/hydra-sync/agent_dispatcher.ts` (propriedade exclusiva do Agente Principal):
  - Injetar memórias recuperadas do `memory_retriever.ts` no prompt do revisor.
  - Invocar `validateAndPersistMemoryCandidates` do `memory_repository.ts` após a resposta do revisor.
- [ ] Rodar o build gate TypeScript em strict mode: `npx tsc --project tsconfig.hydra.json --noEmit` (0 erros).
- [ ] Executar a suíte unificada `test_harness_unified.ts` garantindo 100% de aprovação nos 28 cenários.
- [ ] Empacotar os bundles ESM com `esbuild` para o Node nativo de produção.
- [ ] Sincronizar arquivos para `/opt/bots/` e `/home/operacional/hydra/`, recarregar o PM2 `hydra-bot`.
- [ ] Validar no ambiente operacional com os números autorizados (`5511996242812` / `5511970671717`).
- [ ] Apresentar relatório final integrado detalhado.
