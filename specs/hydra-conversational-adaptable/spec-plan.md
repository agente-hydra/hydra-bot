# Plano de Execução: Hydra Conversacional, Adaptável e Multi-Persona

**ID da Spec:** `hydra-conversational-adaptable`  
**Data:** 30/09/2026  
**Status:** CONCLUÍDO COM ÊXITO (DEPLOY EM PRODUÇÃO & VALIDADO NOS DOIS NÚMEROS)

---

## Fase 0: Congelamento da Base e Setup de Worktrees

- [x] [SETUP] Registrar hash base do commit integrado em produção (`c90f21c` + `5f66a14`) e diff de sanidade.
- [x] [SETUP] Criar branch e worktree para Frente A: `git worktree add /home/operacional/hydra-reasoning -b feat/frente-a-reasoning-retrieval 5f66a14`.
- [x] [SETUP] Criar branch e worktree para Frente B: `git worktree add /home/operacional/hydra-memory -b feat/frente-b-memory-briefing 5f66a14`.
- [x] [SETUP] Criar branch e worktree para Frente C: `git worktree add /home/operacional/hydra-commands -b feat/frente-c-commands-composer 5f66a14`.

---

## Fase 1: Delegação e Execução do Agente 1 (Frente A — Raciocínio & Recuperação)

- [x] [DELEGAÇÃO A] Lançar subagente Agente 1 com prompt calibrado na worktree `/home/operacional/hydra-reasoning`.
- [x] [AGENTE 1] Implementar `types/conversation_contract.ts` (`InterpretationContract`, `AnswerRequirement`, `CAPABILITIES_VERSION = '1.1.0'`).
- [x] [AGENTE 1] Implementar `semantic_glossary.ts` (tabela `hydra_semantic_glossary`, áreas e métricas).
- [x] [AGENTE 1] Atualizar `intent_rewriter.ts` (múltiplas intenções e mapeamento de "óleo" para `faturamento_areas.area = 'OLEO'`).
- [x] [AGENTE 1] Atualizar `operational_adapter.ts` (multi-queries, CMV de óleo por loja no `CATALOGO_10_LOJAS`, validação pré-envio de requisitos).
- [x] [AGENTE 1] Atualizar `dual_worker_router.ts` (orçamento global de turno de 50s compartilhado e códigos `H-IA`).
- [x] [AGENTE 1] Aprovar testes em `tests/test_reasoning_retrieval.ts` (34/34 PASS) e gerar `patch-frente-a-reasoning.diff` (commit `2073d07`).

---

## Fase 2: Delegação e Execução do Agente 2 (Frente B — Memória & Briefings)

- [x] [DELEGAÇÃO B] Lançar subagente Agente 2 com prompt calibrado na worktree `/home/operacional/hydra-memory`.
- [x] [AGENTE 2] Implementar `user_memory_repository.ts` (tabela `hydra_user_memory`, 3 níveis: turno ativo, diária e semanal com decaimento).
- [x] [AGENTE 2] Atualizar `ai_briefing.ts` (briefing executivo personalizado por destinatário mantendo métricas centrais).
- [x] [AGENTE 2] Atualizar `hydra_auditor_service.ts` (tabela `hydra_briefing_dispatches`, gravação de SENT estritamente pós-HTTP 201 e modo `--preview` obrigatório).
- [x] [AGENTE 2] Aprovar testes em `tests/test_user_memory_briefing.ts` (48/48 PASS) e gerar `patch-frente-b-memory.diff` (commit `bd5196c`).

---

## Fase 3: Delegação e Execução do Agente 3 (Frente C — Comandos & Balões)

- [x] [DELEGAÇÃO C] Lançar subagente Agente 3 com prompt calibrado na worktree `/home/operacional/hydra-commands`.
- [x] [AGENTE 3] Implementar `command_interceptor.ts` (`/menu`, `/perfil`, `/reset`, `/socio`, `/{loja}` baseados no `CATALOGO_10_LOJAS`).
- [x] [AGENTE 3] Implementar no `command_interceptor.ts` o aborto imediato de jobs em voo e encerramento de presença ao receber `/reset`.
- [x] [AGENTE 3] Implementar `balloon_composer.ts` (ordem semântica, quebras respeitosas de 700-900 chars, conversão de tabelas em listas WhatsApp).
- [x] [AGENTE 3] Atualizar `format_utils.ts` (sanitização anti-asteriscos duplos).
- [x] [AGENTE 3] Aprovar testes em `tests/test_commands_composer.ts` (106/106 PASS) e gerar `patch-frente-c-commands.diff` (commit `30544c1`).

---

## Fase 4: Integração pelo Principal e Atualização dos Arquivos Centrais

- [x] [INTEGRAÇÃO] Aplicar `patch-frente-a-reasoning.diff`, `patch-frente-b-memory.diff` e `patch-frente-c-commands.diff` em `hydra-staging` (commits `4ef5e2b`, `972d2a8`, `b209c94`).
- [x] [INTEGRAÇÃO] Atualizar `agent_dispatcher.ts` (inclusão de `historyBlock` resumido no prompt do AGY, verificação de `answerRequirements`, fallbacks).
- [x] [INTEGRAÇÃO] Atualizar `webhook-listener.js` (conectar `command_interceptor` no Ingress antes do batcher, registrar cancelamento abortivo de jobs em `/reset`, plugar `balloon_composer` e disparar ✅ pós-confirmação).
- [x] [INTEGRAÇÃO] Rodar build gate: `tsc -p tsconfig.hydra.json --noEmit` (0 erros) e suíte de regressão (>450 testes PASS).

---

## Fase 5: Deploy em Produção e Validação ao Vivo nos DOIS Telefones

- [x] [PRODUÇÃO] Sincronizar módulos para `/opt/bots/src/hydra-sync/` e publicar `webhook-listener.js` em `/home/operacional/hydra/` e `/opt/bots/`.
- [x] [PRODUÇÃO] Recarregar PM2 (`pm2 reload hydra-bot`) e validar status online (PID 445645, 0 erros no log).
- [x] [VALIDAÇÃO LIVE] Validar comandos determinísticos nos DOIS números autorizados (Davi `5511996242812` e Marcos `5511970671717`): `/menu`, `/perfil`, `/santoandre`, `/socio` e `/reset` com aborto em voo (15/15 PASS no teste ao vivo).
- [x] [VALIDAÇÃO LIVE] Validar consulta de área nos dois números: "CMV de óleo das lojas" conferindo valor de óleo por unidade elegível e ausência de substituição por CMV total.
- [x] [VALIDAÇÃO LIVE] Validar pergunta composta nos dois números: "OS e CMV da Jorge Beretta" conferindo os dois requisitos no mesmo balão.
- [x] [VALIDAÇÃO LIVE] Validar preview do briefing diário/semanal personalizado antes do disparo, conferindo idempotência e registro de SENT apenas pós-sucesso (validado com `--preview`).
- [x] [VALIDAÇÃO LIVE] Auditar registros em `message_reactions` e `message_lifecycle` comprovando o ciclo 👀 → digitando → balão → ✅ nos dois telefones.

---

## Fase 6: Relatório Final Único ao Davi

- [x] [RELATÓRIO] Consolidar commits, arquivos, estatísticas de testes, evidências reais com IDs/horários comprovadas em ambos os números, motor utilizado (`AGY_PRIMARY`, `AGY_SECONDARY` ou `FALLBACK_API`) e comprovação de produção sem expor dados privados.
