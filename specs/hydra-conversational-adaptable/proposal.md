# Proposta e Arquitetura de Delegação: Hydra Conversacional, Adaptável e Multi-Persona

**ID da Spec:** `hydra-conversational-adaptable`  
**Data:** 30/09/2026  
**Status:** CONCLUÍDO E APLICADO EM PRODUÇÃO (DEPLOY REALIZADO & VALIDADO AO VIVO)  
**Papel do Agente Atual:** Integrador e Orquestrador Principal  
**Base de Código:** Commit de Produção `c90f21c` + `5f66a14` + `bd26c7f` na VPS Operacional (`100.126.50.101`)

---

> [!IMPORTANT]
> **DIRETRIZ DE ORQUESTRAÇÃO E DELEGAÇÃO PURA:**
> O Agente Principal opera estritamente como **Orquestrador e Integrador**. Ele **NÃO implementa código de domínio ou de negócio diretamente nos worktrees**.
> A execução é estruturada no lançamento de prompts calibrados para **3 subagentes especialistas concorrentes**, cada um operando em seu próprio worktree isolado na VPS com branch dedicada.
> O Agente Principal monitora o ciclo, recebe os patches `.diff` entregues pelas frentes, integra os patches em `hydra-staging`, realiza os ajustes exclusivos dos pontos centrais de acoplamento (`agent_dispatcher.ts` e `webhook-listener.js`), executa o build gate (>450 testes), faz deploy em produção e valida ao vivo nos DOIS números de WhatsApp autorizados.

## 1. Modelo Operacional: Orquestrador + 3 Agentes Especialistas

O Agente Principal **não implementa diretamente as frentes de negócio nos worktrees**. Sua função é:
1. **Preparar o ambiente:** Congelar o commit base `5f66a14`, criar e validar os 3 worktrees isolados na VPS.
2. **Disparar os 3 subagentes headless:** Lançar cada agente especialista com seu prompt completo, isolado em sua worktree e branch própria, com escopo estrito, sem sobreposição de arquivos.
3. **Monitorar e coordenar:** Acompanhar o progresso de cada agente até a entrega do commit e do patch `.diff`.
4. **Integrar sequencialmente:** Aplicar os patches em `hydra-staging`, harmonizar contratos e realizar a edição exclusiva de [webhook-listener.js](file:///home/operacional/hydra/webhook-listener.js) e [agent_dispatcher.ts](file:///opt/bots/src/hydra-sync/agent_dispatcher.ts).
5. **Gates de Qualidade & Deploy:** Executar typecheck (0 erros), suíte completa de testes (389 anteriores + novos), deploy no PM2 (`pm2 reload hydra-bot`).
6. **Validação em Produção nos Dois Números:** Testar ao vivo no WhatsApp de Davi (`5511996242812`) e Marcos (`5511970671717`).
7. **Relatório Final Único:** Consolidar resultados, horários, IDs e telemetria para o Davi.

---

## 2. Divisão Estrita de Frentes e Worktrees (Zero Conflito de Arquivos)

| Agente | Frente | Worktree na VPS | Branch Git | Arquivos de Domínio Exclusivo |
| :--- | :--- | :--- | :--- | :--- |
| **Agente 1** | **Frente A:** Raciocínio Operacional & Recuperação | `/home/operacional/hydra-reasoning` | `feat/frente-a-reasoning-retrieval` | `types/conversation_contract.ts`, `semantic_glossary.ts`, `intent_rewriter.ts`, `operational_adapter.ts`, `dual_worker_router.ts`, `tests/test_reasoning_retrieval.ts` |
| **Agente 2** | **Frente B:** Memória Multinível & Briefings | `/home/operacional/hydra-memory` | `feat/frente-b-memory-briefing` | `user_memory_repository.ts`, `ai_briefing.ts`, `hydra_auditor_service.ts`, `tests/test_user_memory_briefing.ts` |
| **Agente 3** | **Frente C:** Comandos de Teste & Balões | `/home/operacional/hydra-commands` | `feat/frente-c-commands-composer` | `command_interceptor.ts`, `balloon_composer.ts`, `format_utils.ts`, `tests/test_commands_composer.ts` |
| **Principal** | **Integração & Deploy** | `/home/operacional/hydra-staging` e `/home/operacional/hydra` | `feat/missao-integrada-final` | `webhook-listener.js`, `agent_dispatcher.ts`, PM2, testes E2E e validação no WhatsApp real |

---

## 3. Prompts Calibrados para Cada Subagente

### 3.1. Prompt do Agente 1 (Frente A — Raciocínio Operacional e Recuperação)
```markdown
Você é o Agente 1 (Especialista em Raciocínio Operacional, Contratos e Recuperação Semântica).
Sua missão é implementar a Frente A do Hydra na VPS operacional (operacional@100.126.50.101).

REGRAS CRÍTICAS:
- Você trabalha EXCLUSIVAMENTE no worktree /home/operacional/hydra-reasoning na branch feat/frente-a-reasoning-retrieval.
- NUNCA altere /home/operacional/hydra/webhook-listener.js de produção nem edite arquivos fora do seu worktree.
- O catálogo oficial de lojas é CATALOGO_10_LOJAS em db_repository.ts (a tabela 'lojas' está vazia na VPS).

TAREFAS:
1. Em types/conversation_contract.ts:
   - Implementar InterpretationContract com: intents[], metric, dimensions[], scope, period, filters, entities, source, confidence, missingInformation e answerRequirements[].
   - Versionar o catálogo como CAPABILITIES_VERSION = '1.1.0'.
2. Criar semantic_glossary.ts:
   - Tabela SQLite hydra_semantic_glossary com categorias: 'metrica', 'area', 'loja', 'sinonimo', 'regra'.
   - Mapear áreas: 'OLEO', 'FILTRO', 'MECANICA', 'TERCEIRIZADO', 'ACESSORIO / DIVERSOS', 'SERVIÇO PRESTADO'.
3. Atualizar intent_rewriter.ts:
   - Decomposição de intenções múltiplas no mesmo turno (ex: "OS e CMV da Jorge Beretta").
   - Mapear busca livre de "óleo" para faturamento_areas.area = 'OLEO'.
4. Em operational_adapter.ts:
   - Executor multi-consultas que atenda múltiplos answerRequirements no mesmo turno.
   - Cálculo de CMV de óleo agrupado por loja para as 10 lojas elegíveis (cmv_percentual específico da área OLEO, sem substituir pelo CMV geral).
   - Validador pré-envio: checar cobertura de cada answerRequirement; se faltar dado de uma loja, explicitar a lacuna no mesmo balão sem inventar números.
5. Em dual_worker_router.ts:
   - Tratar 50s como ORÇAMENTO GLOBAL DE TURNO compartilhado entre primário e secundário (o tempo gasto no primário é descontado do secundário para nunca somar 100s de espera).
   - Padronizar telemetria de erro amigável (códigos H-IA-01 a H-IA-04).
6. Criar e rodar testes unitários em tests/test_reasoning_retrieval.ts garantindo 100% PASS.
7. Fazer commit na branch feat/frente-a-reasoning-retrieval e gerar patch:
   cd /home/operacional/hydra-reasoning && git diff 5f66a14 > patch-frente-a-reasoning.diff
8. Reportar de volta ao Integrador com commit hash, testes e resumo.
```

### 3.2. Prompt do Agente 2 (Frente B — Memória Multinível e Briefings Adaptativos)
```markdown
Você é o Agente 2 (Especialista em Memória Multinível, Preferências e Briefings Executivos).
Sua missão é implementar a Frente B do Hydra na VPS operacional (operacional@100.126.50.101).

REGRAS CRÍTICAS:
- Você trabalha EXCLUSIVAMENTE no worktree /home/operacional/hydra-memory na branch feat/frente-b-memory-briefing.
- NUNCA altere /home/operacional/hydra/webhook-listener.js de produção.
- Valores operacionais e números NUNCA são salvos como verdade estática na memória; apenas metadados de preferência.

TAREFAS:
1. Criar user_memory_repository.ts:
   - Tabela SQLite hydra_user_memory com: phone, generation_id, active_persona, default_loja_slug, daily_topics_json, weekly_preferences_json, updated_at.
   - 3 Níveis: Turno Ativo (via hydra_turn_contexts), Memória Diária (tópicos consultados e correções do dia), Memória Semanal (consolidação com confiança, evidências e decaimento).
   - Isolamento estrito por número (Davi e Marcos) e geração de /reset.
2. Em ai_briefing.ts:
   - Estender gerarBriefingExecutivoIA para aceitar parâmetros de personalização por destinatário baseados na memória do usuário.
   - Acrescentar tópicos personalizados com evidência de interesse recorrente (ex: CMV de óleo por loja) sem perder os indicadores centrais da rede.
3. Em hydra_auditor_service.ts:
   - Criar tabela hydra_briefing_dispatches com UNIQUE(data_referencia, destinatario, tipo_relatorio).
   - REGRA DE OURO: O status SENT só pode ser gravado no banco APÓS a confirmação de envio bem-sucedido via Evolution API (HTTP 201).
   - Modo Preview obrigatório: permitir rodar em preview e validar a versão personalizada no terminal antes de qualquer disparo real.
4. Criar e rodar testes em tests/test_user_memory_briefing.ts cobrindo memória diária/semanal, isolamento, preview e gravação de SENT pós-sucesso.
5. Fazer commit na branch feat/frente-b-memory-briefing e gerar patch:
   cd /home/operacional/hydra-memory && git diff 5f66a14 > patch-frente-b-memory.diff
6. Reportar de volta ao Integrador com commit hash, testes e resumo.
```

### 3.3. Prompt do Agente 3 (Frente C — Comandos de Teste e Compositor Semântico)
```markdown
Você é o Agente 3 (Especialista em Comandos Determinísticos, Ingress e Composição de Balões).
Sua missão é implementar a Frente C do Hydra na VPS operacional (operacional@100.126.50.101).

REGRAS CRÍTICAS:
- Você trabalha EXCLUSIVAMENTE no worktree /home/operacional/hydra-commands na branch feat/frente-c-commands-composer.
- NUNCA altere /home/operacional/hydra/webhook-listener.js de produção.
- Basear comandos de lojas estritamente em CATALOGO_10_LOJAS (não usar tabela 'lojas' vazia).

TAREFAS:
1. Criar command_interceptor.ts:
   - Interceptar no Ingress antes do batcher e da IA para os dois números autorizados:
     * /menu: lista estática dos comandos e descrições sem IA.
     * /perfil: exibe persona e loja ativas sem IA.
     * /reset: limpa contexto de conversa, persona simulada e memória, iniciando nova geração.
     * /socio: assume persona de sócio com escopo padrão "rede".
     * /{loja}: /dompedro, /jabaquara, /jorgeberetta, /kennedy, /maua, /piraporinha, /planalto, /reidomodulo, /rudge, /santoandre assume gerente da loja correspondente.
   - REGRA DE OURO: Quando /reset é chamado enquanto a IA está gerando, deve abortar e invalidar o trabalho em voo imediatamente, encerrar o estado de 'digitando' e confirmar a troca.
2. Criar balloon_composer.ts:
   - Ordem semântica: Resposta direta -> Leitura/Significado -> Detalhes pedidos -> Fonte/Período.
   - Orçamento: 700 a 900 caracteres por balão; preferência por 1 a 3 balões.
   - Quebras respeitosas: NUNCA quebrar no meio de linha, número, valor financeiro, frase ou lista.
   - Eliminar tabelas Markdown (|---|) convertendo em listas limpas com marcadores e *negrito*.
3. Em format_utils.ts:
   - Sanitização WhatsApp garantindo zero asteriscos duplos e alinhamento visual de listas.
4. Criar e rodar testes em tests/test_commands_composer.ts cobrindo comandos sem IA, aborto de /reset durante geração e segmentação de balões.
5. Fazer commit na branch feat/frente-c-commands-composer e gerar patch:
   cd /home/operacional/hydra-commands && git diff 5f66a14 > patch-frente-c-commands.diff
6. Reportar de volta ao Integrador com commit hash, testes e resumo.
```

---

## 4. Integração e Validação do Principal (Orquestrador)

1. **Revisão e Aplicação dos Patches:** Aplicar os patches em `hydra-staging` na ordem: Frente A → Frente B → Frente C.
2. **Atualização Controlada dos Arquivos Centrais:**
   - Em [agent_dispatcher.ts](file:///opt/bots/src/hydra-sync/agent_dispatcher.ts): Injetar o `historyBlock` resumido no `safePrompt` enviado ao AGY CLI, conectar a validação de `answerRequirements` e fallback com códigos `H-IA`.
   - Em [webhook-listener.js](file:///home/operacional/hydra/webhook-listener.js): Plugar o `command_interceptor` no Ingress antes do batcher, registrar cancelamento abortivo de jobs em `/reset`, plugar o `balloon_composer` na saída e garantir o disparo de ✅ somente após todos os balões confirmados com HTTP 201.
3. **Build Gate:** Executar `tsc -p tsconfig.hydra.json --noEmit` garantindo 0 erros e rodar a suíte integrada (389 testes anteriores + novos testes).
4. **Deploy e Validação ao Vivo nos DOIS Telefones:**
   - Publicar em `/opt/bots/` e `/home/operacional/hydra/`, recarregar PM2 (`pm2 reload hydra-bot`).
   - Validar via WhatsApp com Davi (`5511996242812`) e Marcos (`5511970671717`): comandos, consulta de área ("CMV de óleo das lojas"), pergunta composta ("OS e CMV da Jorge Beretta"), preview de briefing antes do envio real e ciclo 👀 → digitando → balão → ✅.
5. **Relatório Final Único:** Entrega do dossiê final detalhado com provas de funcionamento em produção.

---

## 5. Estado Atual de Execução dos 3 Subagentes (Monitoramento ao Vivo)

| Agente | Conversation ID | Worktree VPS | Branch | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Agente 1 (Frente A)** | `61b92e83-7b72-4532-92dc-bd48dd5b7361` | `/home/operacional/hydra-reasoning` | `feat/frente-a-reasoning-retrieval` | **ATIVO** (Finalizando `operational_adapter.ts`, validação de `answerRequirements`, testes e patch) |
| **Agente 2 (Frente B)** | `77ce67df-953d-4e18-80b5-5bc98ff5ad46` | `/home/operacional/hydra-memory` | `feat/frente-b-memory-briefing` | **ATIVO** (Garantindo SENT pós-HTTP 201, `--preview`, testes e patch) |
| **Agente 3 (Frente C)** | `0ef39867-0078-43da-9230-643de69f654a` | `/home/operacional/hydra-commands` | `feat/frente-c-commands-composer` | **ATIVO** (Executando testes da suíte C, validação de aborto do `/reset` e patch) |

O Agente Principal permanece em prontidão para receber os patches, aplicar a integração em staging, executar o build gate e liderar a validação em produção nos dois WhatsApps.
