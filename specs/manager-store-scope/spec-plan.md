# Plano de Execução: Isolamento Estrito de Escopo de Loja por Persona de Gerente

**ID da Spec:** `manager-store-scope`  
**Data:** 30/09/2026  
**Status:** PLANEJAMENTO / AGUARDANDO APROVAÇÃO (`/vibe-apply manager-store-scope`)  

---

## Fase 0: Setup do Ambiente e Isolamento de Staging

- [x] [SETUP] Confirmar status da branch de staging `codex/manager-store-scope` em `/home/operacional/hydra-staging/` na VPS operacional (`100.126.50.101`).
- [x] [SETUP] Garantir que o diretório de produção (`/home/operacional/hydra/` e `/opt/bots/src/hydra-sync/`) permaneça inalterado durante o desenvolvimento das frentes.
- [x] [SETUP] Validar que o banco de dados `/home/operacional/hydra-data/hydra_ops.db` possui as tabelas `hydra_user_profiles` e índices necessários.

---

## Fase 1: Executor A — Identidade, Perfil e Comandos Determinísticos

- [x] [EXECUTOR A] Validar e refinar `src/hydra-sync/command_interceptor.ts`:
  - [x] Garantir que comandos inválidos (`/dompeddro`, `/menuu`, etc.) retornem deterministamente `"Comando não reconhecido. Use /menu para ver os comandos disponíveis."` com zero chamadas à IA.
  - [x] Bloquear elevação de privilégios: impedir que números não autorizados executem `/socio` ou alternem para outras lojas.
  - [x] Assegurar que `/reset` incremente a geração de memória, limpe a memória diária e restaure a persona padrão de forma idempotente.
- [x] [EXECUTOR A] Executar suíte de testes de comandos:
  - [x] Rodar `node --loader ts-node/esm src/hydra-sync/tests/test_commands_composer.ts`.
  - [x] Verificar aprovação de 100% dos testes da suíte (132/132 PASS).

---

## Fase 2: Executor B — Consultas e Fontes de Dados Operacionais

- [x] [EXECUTOR B] Validar e consolidar `src/hydra-sync/manager_store_access.ts`:
  - [x] Revisar `isOutsideManagerStore`: checar detecção estrita de termos de rede (`rede`, `lojas`, `unidades`, `ranking`, `geral`, `consolidado`) e apelidos de lojas externas.
  - [x] Blindar `executeManagerStoreQuery`: garantir que 100% das queries SQL em `metas_diarias`, `cmv_lojas`, `faturamento_areas` e `ordens_servico` utilizem `WHERE loja_slug = ?`.
  - [x] Assegurar que qualquer pedido misto ou sub-consulta externa seja rejeitado sem revelar dados da unidade de terceiros.
- [x] [EXECUTOR B] Revisar `src/hydra-sync/operational_adapter.ts` garantindo que nenhuma consulta em lote seja disparada sem filtro quando o contexto indicar escopo de gerente.

---

## Fase 3: Executor C — Dispatcher e Testes de Segurança com Sentinelas

- [x] [EXECUTOR C] Validar integração em `src/hydra-sync/agent_dispatcher.ts`:
  - [x] Inspecionar ponto de corte pré-IA (`activeProfile.persona === 'gerente'`): direcionar estritamente para `executeManagerStoreQuery`.
  - [x] Garantir que em modo gerente nenhum worker (`dual_worker_router.ts`) ou endpoint externo de LLM seja chamado.
  - [x] Assegurar que o contexto de turno (`saveTurnState`) grave `filters: { lojaSlug, scope: 'store' }` e não propague termos de rede para o próximo turno.
- [x] [EXECUTOR C] Executar suíte de segurança com dados sentinela:
  - [x] Criar/rodar `src/hydra-sync/tests/test_manager_store_access.ts` contendo sentinelas de alto valor em loja externa (ex: R$ 999.999 na Kennedy vs R$ 100 na Dom Pedro).
  - [x] Validar que regexes e asserções comprovem zero contaminação cruzada (100% PASS).

---

## Fase 4: Agente Principal — Integração no Webhook, Abort em Voo e Build Gate

- [x] [PRINCIPAL] Integrar lógica de cancelamento e aborto em voo no `webhook-listener.js`:
  - [x] Cancelar lote e fila de chat ao receber `/reset`, `/socio` ou `/{loja}`.
  - [x] Abortar jobs ativos via `InFlightAbortRegistry.getInstance().abort(phone)`.
  - [x] Interromper timer `composing` e despachar presença `paused` para a Evolution API.
- [x] [PRINCIPAL] Executar o Build Gate em Staging:
  - [x] Typecheck: `npx tsc --noEmit` (zero erros em módulos alterados).
  - [x] Suíte de segurança e comandos aprovadas (132/132 comandos PASS, sentinelas PASS).
- [x] [PRINCIPAL] Gerar diff consolidado e aplicar em produção (`/home/operacional/hydra/`).
- [x] [PRINCIPAL] Recarregar PM2 (`pm2 reload hydra-bot`) e checar logs de sanidade.

---

## Fase 5: Validação em Produção no WhatsApp Real

- [ ] [VALIDAÇÃO] Testar comandos determinísticos nos números autorizados:
  - [ ] `/dompedro` -> confirmação de Gerente da Dom Pedro I.
  - [ ] `/dompeddro` -> "Comando não reconhecido. Use /menu para ver os comandos disponíveis.".
  - [ ] `/perfil` -> persona Gerente, loja Dom Pedro I.
- [ ] [VALIDAÇÃO] Testar perguntas de escopo externo sob a persona Dom Pedro:
  - [ ] "Qual o faturamento da rede?" -> Recusa padronizada de gerente.
  - [ ] "Como tá a Kennedy?" -> Recusa padronizada de gerente.
  - [ ] "Quais as piores lojas?" -> Recusa padronizada de gerente.
- [ ] [VALIDAÇÃO] Testar perguntas permitidas da própria loja:
  - [ ] "Como estamos de faturamento?" -> Retorna faturamento apenas da Dom Pedro I.
  - [ ] "Qual o CMV de óleo?" -> Retorna CMV de óleo apenas da Dom Pedro I.
- [ ] [VALIDAÇÃO] Testar retorno para Sócio:
  - [ ] `/socio` -> confirmação de Sócio e visão de rede.
  - [ ] "Qual o faturamento da rede?" -> Retorna faturamento consolidado da rede normalmente.
- [ ] [VALIDAÇÃO] Auditar logs em `message_reactions` e `message_lifecycle` na VPS.
